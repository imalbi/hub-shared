import { readFileSync } from 'node:fs';
import type { Run, RunResult } from '../../apps/server/src/core/exec.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { ENVELOPE_SCHEMA_ARGS, envelopeSchema, messageViewSchema, plainTextOf, VERSION_ARGS } from './himalaya.ts';

// Invented accounts and messages (example.org only); the shapes are those `himalaya --json` prints.
const accounts = z
  .record(z.string(), z.record(z.string(), z.array(envelopeSchema)))
  .parse(JSON.parse(readFileSync(new URL('./fixtures/accounts.json', import.meta.url), 'utf8')));
const messages = z
  .record(z.string(), messageViewSchema)
  .parse(JSON.parse(readFileSync(new URL('./fixtures/messages.json', import.meta.url), 'utf8')));
const schemaText = readFileSync(new URL('./fixtures/envelope-list.schema.json', import.meta.url), 'utf8');

type Envelope = z.output<typeof envelopeSchema>;
type Row = Omit<Envelope, 'flags'> & { account: string; flags: Set<string> };
type Predicate = (row: Row) => boolean;
type ViewOf = (account: string, id: string) => z.output<typeof messageViewSchema> | undefined;

const ok = (stdout: string): RunResult => ({ stdout, stderr: '', code: 0 });
const refused: RunResult = { stdout: '', stderr: 'fake desktop: himalaya command not supported', code: 127 };
const VALUE_OPTIONS = new Set(['-m', '-p', '-s', '-f', '-t']);
// A word, or a double-quoted value with `\` escapes: the forms Hub's query builder produces.
const TOKEN = /"((?:\\.|[^"\\])*)"|(\S+)/g;

type Word = { text: string; quoted: boolean };

/** The fixture's flags as himalaya names them, the way `flag add` and `flag remove` change them. */
function createFlags(): Map<string, Set<string>> {
  const flags = new Map<string, Set<string>>();
  for (const [account, mailboxes] of Object.entries(accounts)) {
    for (const envelopes of Object.values(mailboxes)) {
      for (const envelope of envelopes) {
        flags.set(`${account}/${envelope.id}`, new Set(envelope.flags.map((flag) => flag.iana ?? flag.raw)));
      }
    }
  }
  return flags;
}

type Boxes = Record<string, Record<string, Envelope[]>>;

function rowsOf(boxes: Boxes, account: string, mailbox: string, flags: Map<string, Set<string>>): Row[] | null {
  const envelopes = boxes[account]?.[mailbox];
  if (!envelopes) return null;
  return envelopes.map((envelope) => ({
    ...envelope,
    account,
    flags: flags.get(`${account}/${envelope.id}`) ?? new Set(),
  }));
}

function toEnvelope(row: Row): Envelope {
  const { account: _account, flags, ...rest } = row;
  return {
    ...rest,
    flags: [...flags].map((name) => ({ raw: `\\${name[0]?.toUpperCase()}${name.slice(1)}`, iana: name })),
  };
}

function words(query: readonly string[]): Word[] {
  return [...query.join(' ').matchAll(TOKEN)].map((match) =>
    match[1] === undefined
      ? { text: match[2] ?? '', quoted: false }
      : { text: match[1].replace(/\\(.)/g, '$1'), quoted: true },
  );
}

function predicateFor(key: string, value: string, viewOf: ViewOf): Predicate | null {
  const lower = value.toLowerCase();
  if (key === 'from')
    return (row) => row.from.some((a) => `${a.name ?? ''} ${a.email ?? ''}`.toLowerCase().includes(lower));
  if (key === 'subject') return (row) => row.subject.toLowerCase().includes(lower);
  if (key === 'body')
    return (row) =>
      JSON.stringify(viewOf(row.account, row.id)?.parts ?? [])
        .toLowerCase()
        .includes(lower);
  if (key === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    // himalaya's `after` leaves out the named day itself.
    return (row) => (row.date ?? '').slice(0, 10) > value;
  if (key === 'flag' && (value === 'seen' || value === 'flagged')) return (row) => row.flags.has(value);
  return null;
}

/** `term and term`, each term `[not] key value`; anything else is null, which the fake refuses. */
function parseQuery(query: readonly string[], viewOf: ViewOf): Predicate[] | null {
  const tokens = words(query);
  const predicates: Predicate[] = [];
  let index = 0;
  while (index < tokens.length) {
    if (predicates.length > 0) {
      if (tokens[index]?.text !== 'and' || tokens[index]?.quoted) return null;
      index++;
    }
    const negated = tokens[index]?.text === 'not' && !tokens[index]?.quoted;
    if (negated) index++;
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key || key.quoted || !value) return null;
    const predicate = predicateFor(key.text, value.text, viewOf);
    if (!predicate) return null;
    predicates.push(negated ? (row) => !predicate(row) : predicate);
    index += 2;
  }
  return predicates.length > 0 ? predicates : null;
}

/** Options with a value, plus positional words. Any other option (such as `--seen`) is not known here. */
function split(args: readonly string[]): { options: Map<string, string>; positional: string[] } | null {
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg.startsWith('-')) {
      if (!VALUE_OPTIONS.has(arg) || args[index + 1] === undefined) return null;
      options.set(arg, args[index + 1] ?? '');
      index++;
    } else {
      positional.push(arg);
    }
  }
  return { options, positional };
}

const OWNER = { name: 'Owner', email: 'owner@example.org' };
// Sent mail gets a fixed day: the fake has no clock, and a listing sorts by date.
const SENT_DATE = '2026-11-14T10:00:00Z';

type Send = { options: Map<string, string[]>; flags: Set<string>; id: string | undefined; mailbox: string };

/** The argv shapes of `composeArgs` and `replyArgs`: `--key=value` options, `--send`, `--save <box>`, `-m <box>`, one id. */
function parseSend(args: readonly string[]): Send | null {
  const options = new Map<string, string[]>();
  const flags = new Set<string>();
  let id: string | undefined;
  let mailbox = 'INBOX';
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const named = /^--(to|cc|subject|body)=([\s\S]*)$/.exec(arg);
    if (named?.[1]) options.set(named[1], [...(options.get(named[1]) ?? []), named[2] ?? '']);
    else if (arg === '--send') flags.add('send');
    else if (arg === '--save' && args[index + 1] !== undefined) options.set('save', [args[++index] ?? '']);
    else if (arg === '-m' && args[index + 1] !== undefined) mailbox = args[++index] ?? 'INBOX';
    else if (!arg.startsWith('-') && id === undefined) id = arg;
    else return null;
  }
  return { options, flags, id, mailbox };
}

function page(rows: readonly Row[], pageNumber: number, size: number) {
  const start = (pageNumber - 1) * size;
  return rows.slice(start, start + size).map(toEnvelope);
}

function newestFirst(rows: Row[]): Row[] {
  return rows.toSorted((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

/**
 * The answer to one `himalaya` call, for the exact argv Hub builds. Flag changes are kept per desktop, so a test sees
 * its own `flag add` in the next listing. Anything else is refused: a command Hub never sends must fail the test.
 */
export function createFakeHimalaya(): (args: readonly string[]) => RunResult {
  const flags = createFlags();
  // Moves and sent mail change the mailboxes, so each desktop works on its own copy.
  const boxes: Boxes = structuredClone(accounts);
  // A moved message gets a new id, as on IMAP; its text is still found under the one it had.
  const origin = new Map<string, string>();
  let counter = 0;
  const viewOf: ViewOf = (account, id) => {
    let key = `${account}/${id}`;
    while (origin.has(key)) key = origin.get(key) ?? key;
    return messages[key];
  };

  return (args) => {
    if (args.length === 1 && args[0] === VERSION_ARGS[0]) return ok('himalaya v2.2.1 (fake)\n');
    if (args.join(' ') === ENVELOPE_SCHEMA_ARGS.join(' ')) return ok(schemaText);
    if (args[0] !== '--json' || args[1] !== '-a' || args[2] === undefined) return refused;
    const account = args[2];
    const rest = args.slice(3);
    const [group, action] = rest;
    // Composing has its own argv shape (`--key=value`), read by `parseSend`.
    const composing = group === 'message' && (action === 'compose' || action === 'reply');
    const parsed = composing ? { options: new Map<string, string>(), positional: [] } : split(rest.slice(2));
    if (!parsed || !(account in accounts)) return refused;
    const { options, positional } = parsed;

    if (group === 'mailbox' && action === 'list') {
      return ok(JSON.stringify({ mailboxes: Object.keys(boxes[account] ?? {}).map((name) => ({ id: name, name })) }));
    }

    if (group === 'envelope' && (action === 'list' || action === 'search')) {
      const mailbox = options.get('-m') ?? 'INBOX';
      const pageNumber = Number(options.get('-p') ?? 1);
      const size = Number(options.get('-s') ?? 25);
      const all = rowsOf(boxes, account, mailbox, flags);
      if (!all) return refused;
      const predicates = action === 'search' ? parseQuery(positional, viewOf) : [];
      if (!predicates) return refused;
      const matched = newestFirst(all.filter((row) => predicates.every((predicate) => predicate(row))));
      return ok(JSON.stringify({ queued: 0, envelopes: page(matched, pageNumber, size) }));
    }

    if (group === 'message' && action === 'read') {
      const id = positional[0];
      const view = id ? viewOf(account, id) : undefined;
      return view && positional.length === 1 ? ok(JSON.stringify(view)) : refused;
    }

    if (group === 'flag' && (action === 'add' || action === 'remove')) {
      const flag = options.get('-f');
      const mailbox = options.get('-m') ?? 'INBOX';
      const inbox = rowsOf(boxes, account, mailbox, flags);
      if (!inbox || mailbox !== 'INBOX' || (flag !== 'seen' && flag !== 'flagged') || positional.length === 0)
        return refused;
      for (const id of positional) {
        if (!inbox.some((row) => row.id === id)) return refused;
      }
      for (const id of positional) {
        const set = flags.get(`${account}/${id}`) ?? new Set<string>();
        if (action === 'add') set.add(flag);
        else set.delete(flag);
        flags.set(`${account}/${id}`, set);
      }
      return ok(JSON.stringify({ flags: [flag] }));
    }

    if (group === 'message' && (action === 'compose' || action === 'reply')) {
      const send = parseSend(rest.slice(2));
      if (!send || !send.options.has('body')) return refused;
      const body = send.options.get('body')?.[0] ?? '';
      const source =
        action === 'reply' ? rowsOf(boxes, account, send.mailbox, flags)?.find((row) => row.id === send.id) : undefined;
      if (action === 'reply' && !source) return refused;
      if (action === 'compose' && (send.id !== undefined || !send.options.has('to') || !send.options.has('subject')))
        return refused;
      const replyTo = source?.from[0];
      const to = send.options.get('to') ?? (replyTo?.email ? [replyTo.email] : []);
      const subject = source
        ? source.subject.startsWith('Re: ')
          ? source.subject
          : `Re: ${source.subject}`
        : (send.options.get('subject')?.[0] ?? '');
      if (!send.flags.has('send')) {
        // The preview: himalaya's decoded template, whose body is the quoted text only.
        const text = source
          ? plainTextOf(viewOf(account, source.id) ?? { parts: [], text_body: [], html_body: [] })
          : '';
        const quoted = `${replyTo?.name ?? replyTo?.email ?? ''} ha scritto:\n${text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n')}`;
        return ok(JSON.stringify({ from: null, to, cc: send.options.get('cc') ?? [], bcc: [], subject, body: quoted }));
      }
      if (send.options.get('save')?.[0] !== 'sent' || body.trim().length === 0) return refused;
      const sentBox = (boxes[account] ??= {});
      const sent = (sentBox['sent'] ??= []);
      sent.push({
        id: `s${++counter}`,
        'message-id': `sent-${counter}@example.org`,
        'in-reply-to': source?.['message-id'] ? [source['message-id']] : [],
        flags: [{ raw: '\\Seen', iana: 'seen' }],
        subject,
        from: [OWNER],
        to: to.map((email) => ({ name: null, email })),
        date: SENT_DATE,
        size: body.length,
        'has-attachment': false,
      });
      return ok('{}');
    }

    if (group === 'message' && action === 'move') {
      const from = options.get('-f');
      const to = options.get('-t');
      const source = from ? rowsOf(boxes, account, from, flags) : null;
      if (!from || !to || !source || !boxes[account]?.[to] || positional.length === 0) return refused;
      if (positional.some((id) => !source.some((row) => row.id === id))) return refused;
      for (const id of positional) {
        const index = boxes[account][from]?.findIndex((envelope) => envelope.id === id) ?? -1;
        const [envelope] = boxes[account][from]?.splice(index, 1) ?? [];
        if (!envelope) continue;
        const moved = `x${++counter}`;
        origin.set(`${account}/${moved}`, `${account}/${id}`);
        flags.set(`${account}/${moved}`, new Set(flags.get(`${account}/${id}`)));
        boxes[account][to]?.push({ ...envelope, id: moved });
      }
      return ok('{}');
    }

    return refused;
  };
}

export function createFakeMailRun({
  calls = [],
  notifications = [],
}: {
  calls?: string[][];
  notifications?: string[][];
} = {}): Run {
  const desktop = createFakeDesktop({ notifications });
  const fake = createFakeHimalaya();
  return (bin, args, options) => {
    if (bin === 'himalaya') {
      calls.push([...args]);
      return Promise.resolve(fake(args));
    }
    return desktop(bin, args, options);
  };
}
