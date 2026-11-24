import { parseHTML } from 'linkedom';
import type { Run } from '../../apps/server/src/core/exec.ts';
import { z, type MailMessage } from '../../apps/server/src/core/module.ts';

// A mail account answers after a login and a listing over the network: the default 3 s of `run` is too short.
export const MAIL_TIMEOUT_MS = 20_000;
export const PAGE_SIZE = 25;
// The unread count and the latest rows come from one listing; past this many rows the count says "at least".
export const UNREAD_WINDOW = 100;
export const THREAD_WINDOW = 200;
export const MAX_TEXT_CHARS = 200_000;

const BIN = 'himalaya';

export type MailFailure = 'timeout' | 'failed' | 'unreadable';
export type MailResult<T> = { ok: true; value: T } | { ok: false; failure: MailFailure };
export type { MailMessage };

// Values that reach argv: ids and mailbox names never start with `-`, so himalaya cannot read them as an option.
export const idSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
export const mailboxSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[^\s-][^\0\r\n]*$/);
export const queryValueSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\0\r\n]+$/);

/** What the UI may ask for. Built into himalaya tokens by `filterTokens`; no free-form query reaches himalaya. */
export const filterSchema = z.object({
  from: queryValueSchema.optional(),
  subject: queryValueSchema.optional(),
  body: queryValueSchema.optional(),
  after: z.iso.date().optional(),
  unseen: z.boolean().optional(),
});
export type MailFilter = z.infer<typeof filterSchema>;

/** Quoted so that a space, `and`, `or` or a quote inside the value stays one literal word of himalaya's query. */
export function quoteValue(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`;
}

/** Each element is one token of the query. himalaya joins them with spaces and parses the result, so they are kept whole. */
export function filterTokens(filter: MailFilter): string[] {
  const terms: string[][] = [];
  if (filter.from) terms.push(['from', quoteValue(filter.from)]);
  if (filter.subject) terms.push(['subject', quoteValue(filter.subject)]);
  if (filter.body) terms.push(['body', quoteValue(filter.body)]);
  if (filter.after) terms.push(['after', filter.after]);
  if (filter.unseen) terms.push(['not', 'flag', 'seen']);
  return terms.flatMap((term, index) => (index === 0 ? term : ['and', ...term]));
}

const common = (account: string) => ['--json', '-a', account];

export function listArgs(account: string, mailbox: string, page: number, size: number): string[] {
  return [...common(account), 'envelope', 'list', '-m', mailbox, '-p', String(page), '-s', String(size)];
}

export function searchArgs(account: string, mailbox: string, page: number, size: number, filter: MailFilter) {
  return [
    ...common(account),
    'envelope',
    'search',
    '-m',
    mailbox,
    '-p',
    String(page),
    '-s',
    String(size),
    ...filterTokens(filter),
  ];
}

/** No `--seen`: reading leaves the flags alone, marking is a separate action. */
export function readArgs(account: string, mailbox: string, id: string): string[] {
  return [...common(account), 'message', 'read', '-m', mailbox, id];
}

export function flagArgs(account: string, mailbox: string, add: boolean, flag: string, ids: readonly string[]) {
  return [...common(account), 'flag', add ? 'add' : 'remove', '-m', mailbox, '-f', flag, ...ids];
}

/** Where himalaya copies what Hub sends: explicit, so it does not depend on the owner's `save-copy` setting. */
export const SENT_MAILBOX = 'sent';

// Values that reach argv as `--flag=<text>`: one element each, so a value starting with `-` is never read as a flag.
// A NUL cannot be part of an argv element.
export const recipientsSchema = z.array(z.email().max(254)).max(20);
export const subjectSchema = z
  .string()
  .max(300)
  .regex(/^[^\0\r\n]*$/);
export const bodySchema = z
  .string()
  .max(20_000)
  .regex(/^[^\0]*$/)
  .refine((text) => text.trim().length > 0);

export type Outgoing = { to: readonly string[]; cc?: readonly string[]; subject: string; body: string };

const addressOptions = (to: readonly string[], cc: readonly string[] = []) => [
  ...to.map((address) => `--to=${address}`),
  ...cc.map((address) => `--cc=${address}`),
];
const sendOptions = ['--send', '--save', SENT_MAILBOX];

export function composeArgs(account: string, mail: Outgoing): string[] {
  return [
    ...common(account),
    'message',
    'compose',
    ...addressOptions(mail.to, mail.cc),
    `--subject=${mail.subject}`,
    `--body=${mail.body}`,
    ...sendOptions,
  ];
}

/** himalaya fills In-Reply-To, References, `Re:` and the quote itself; `to` and `cc` only override its recipients. */
export function replyArgs(
  account: string,
  mailbox: string,
  id: string,
  mail: { to?: readonly string[]; cc?: readonly string[]; body: string },
): string[] {
  return [
    ...common(account),
    'message',
    'reply',
    '-m',
    mailbox,
    ...addressOptions(mail.to ?? [], mail.cc),
    `--body=${mail.body}`,
    ...sendOptions,
    id,
  ];
}

/** The decoded fields without sending. An explicit empty body: with none given himalaya would wait on stdin. */
export function replyDraftArgs(account: string, mailbox: string, id: string): string[] {
  return [...common(account), 'message', 'reply', '-m', mailbox, '--body=', id];
}

/** `--from` is the mailbox the message is in: himalaya assumes the inbox when it is omitted. */
export function moveArgs(account: string, from: string, to: string, ids: readonly string[]): string[] {
  return [...common(account), 'message', 'move', '-f', from, '-t', to, ...ids];
}

export const VERSION_ARGS = ['--version'];
export const ENVELOPE_SCHEMA_ARGS = ['json-schema', 'himalaya-envelope-list'];

const addressSchema = z.object({ name: z.string().nullish(), email: z.string().nullish() });
const flagSchema = z.object({ raw: z.string(), iana: z.string().nullish() });
export const envelopeSchema = z.object({
  id: z.string().min(1),
  'message-id': z.string().nullish(),
  'in-reply-to': z.array(z.string()).default([]),
  flags: z.array(flagSchema).default([]),
  subject: z.string().default(''),
  from: z.array(addressSchema).default([]),
  to: z.array(addressSchema).default([]),
  date: z.string().nullish(),
  size: z.number().nonnegative().default(0),
  'has-attachment': z.boolean().nullish(),
});
export const envelopesSchema = z.object({
  queued: z.number().nonnegative().default(0),
  envelopes: z.array(envelopeSchema),
});
type RawEnvelope = z.output<typeof envelopeSchema>;

/** The fields of `envelope list` that Hub reads; `missingEnvelopeFields` checks them against himalaya's own schema. */
export const ENVELOPE_FIELDS = [
  'id',
  'message-id',
  'in-reply-to',
  'flags',
  'subject',
  'from',
  'to',
  'date',
  'size',
  'has-attachment',
] as const;

/** Fields of `$defs.Envelope` in `himalaya json-schema himalaya-envelope-list` that this parser does not have. */
export function missingEnvelopeFields(schemaText: string): string[] | null {
  const parsed = z
    .object({ $defs: z.object({ Envelope: z.object({ properties: z.record(z.string(), z.unknown()) }) }) })
    .safeParse(parseJson(schemaText));
  if (!parsed.success) return null;
  const fields = parsed.data.$defs.Envelope.properties;
  return ENVELOPE_FIELDS.filter((field) => !(field in fields));
}

/** What `message reply --json` prints without `--send`: the template himalaya would send (`body` is the quoted text). */
export const replyDraftSchema = z.object({
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().nullish(),
  body: z.string().default(''),
});

export const flagResultSchema = z.object({ flags: z.array(z.string()) });

export const messageViewSchema = z.object({
  parts: z.array(z.object({ body: z.unknown().optional() })),
  text_body: z.array(z.number().int().nonnegative()).default([]),
  html_body: z.array(z.number().int().nonnegative()).default([]),
});
export type MessageView = z.output<typeof messageViewSchema>;

export function toMessage(envelope: RawEnvelope): MailMessage {
  const flags = envelope.flags.map((flag) => (flag.iana ?? flag.raw).toLowerCase());
  const sender = envelope.from[0];
  return {
    id: envelope.id,
    messageId: envelope['message-id'] ?? null,
    subject: envelope.subject,
    from: sender ? { name: sender.name ?? null, email: sender.email ?? null } : null,
    date: envelope.date ?? null,
    seen: flags.some((flag) => flag === 'seen' || flag === '\\seen'),
    flagged: flags.some((flag) => flag === 'flagged' || flag === '\\flagged'),
    hasAttachment: envelope['has-attachment'] ?? null,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isErrorPayload = (value: unknown) => typeof value === 'object' && value !== null && 'error' in value;

/**
 * Runs himalaya with `--json` and parses its answer. A failed run, a timeout and an answer in an unexpected shape
 * are reasons, never exceptions: the caller turns them into an error state with a generic message.
 */
export async function himalaya<S extends z.ZodType>(
  run: Run,
  args: readonly string[],
  schema: S,
  timeoutMs = MAIL_TIMEOUT_MS,
): Promise<MailResult<z.output<S>>> {
  const result = await run(BIN, [...args], { timeoutMs });
  // `run` reports a timeout and a missing binary alike as -1.
  if (result.code === -1) return { ok: false, failure: 'timeout' };
  if (result.code !== 0) return { ok: false, failure: 'failed' };
  const json = parseJson(result.stdout);
  if (json === undefined) return { ok: false, failure: 'unreadable' };
  // himalaya prints its errors as JSON too; the exit code alone is not enough.
  if (isErrorPayload(json)) return { ok: false, failure: 'failed' };
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, failure: 'unreadable' };
}

/**
 * For commands whose `--json` answer Hub does not read (send, move): only the exit code and an error payload count.
 */
export async function himalayaDone(
  run: Run,
  args: readonly string[],
  timeoutMs = MAIL_TIMEOUT_MS,
): Promise<MailResult<true>> {
  const result = await run(BIN, [...args], { timeoutMs });
  if (result.code === -1) return { ok: false, failure: 'timeout' };
  if (result.code !== 0 || isErrorPayload(parseJson(result.stdout))) return { ok: false, failure: 'failed' };
  return { ok: true, value: true };
}

const textBody = z.object({ Text: z.string() });
const htmlBody = z.object({ Html: z.string() });

/**
 * The text of a message as plain text. `text_body` may point at an HTML part (an HTML-only message), so the text
 * comes from `Text` parts first, and only when there are none from the HTML parts, stripped of their markup.
 */
export function plainTextOf(message: MessageView): string {
  const bodyAt = (index: number) => message.parts[index]?.body;
  const texts = message.text_body.flatMap((index) => {
    const parsed = textBody.safeParse(bodyAt(index));
    return parsed.success ? [parsed.data.Text] : [];
  });
  if (texts.length > 0) return normalizeText(texts.join('\n'));
  const htmls = message.html_body.flatMap((index) => {
    const parsed = htmlBody.safeParse(bodyAt(index));
    return parsed.success ? [htmlToText(parsed.data.Html)] : [];
  });
  return normalizeText(htmls.join('\n'));
}

const BLOCK_TAGS = 'p, div, li, tr, h1, h2, h3, h4, h5, h6';

/**
 * Only text leaves this function: the tree is read, never returned, and scripts and styles are dropped with their
 * contents.
 */
export function htmlToText(html: string): string {
  // A bare fragment parses without a body element, so it is wrapped in one. Not removing `head`: that leaves linkedom
  // without a document element and `body` then throws.
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  for (const node of document.querySelectorAll('script, style, title')) node.remove();
  for (const node of document.querySelectorAll('br')) node.replaceWith('\n');
  for (const node of document.querySelectorAll(BLOCK_TAGS)) node.append('\n');
  return document.body?.textContent ?? '';
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Keeps the answer bounded; the flag tells the reader something was cut. */
export function capText(text: string): { text: string; truncated: boolean } {
  return text.length > MAX_TEXT_CHARS
    ? { text: text.slice(0, MAX_TEXT_CHARS), truncated: true }
    : { text, truncated: false };
}
