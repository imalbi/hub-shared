import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Run, RunResult } from '../../apps/server/src/core/exec.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { createFakeMailRun } from './fake-himalaya.ts';
import {
  bodySchema,
  composeArgs,
  envelopesSchema,
  filterSchema,
  filterTokens,
  himalaya,
  himalayaDone,
  htmlToText,
  idSchema,
  MAIL_TIMEOUT_MS,
  messageViewSchema,
  missingEnvelopeFields,
  moveArgs,
  plainTextOf,
  quoteValue,
  recipientsSchema,
  replyArgs,
  replyDraftArgs,
  searchArgs,
  subjectSchema,
  toMessage,
} from './himalaya.ts';

const messages = z
  .record(z.string(), messageViewSchema)
  .parse(JSON.parse(readFileSync(new URL('fixtures/messages.json', import.meta.url), 'utf8')));
const schemaText = readFileSync(new URL('fixtures/envelope-list.schema.json', import.meta.url), 'utf8');

void test('a value with spaces, and or or quotes stays one token of the query', () => {
  assert.deepEqual(filterTokens({ subject: 'Offerta and dintorni' }), ['subject', '"Offerta and dintorni"']);
  assert.deepEqual(filterTokens({ from: 'x or "y"' }), ['from', '"x or \\"y\\""']);
  assert.equal(quoteValue('a\\b'), '"a\\\\b"');
});

void test('an unseen filter combined with a sender is the token list himalaya parses', () => {
  assert.deepEqual(filterTokens({ from: 'Alice', unseen: true }), ['from', '"Alice"', 'and', 'not', 'flag', 'seen']);
  assert.deepEqual(filterTokens({ after: '2026-11-01' }), ['after', '2026-11-01']);
  assert.deepEqual(filterTokens({}), []);
});

void test('a search is the full argv: --json, the account, the mailbox, the page and the query as separate elements', () => {
  assert.deepEqual(searchArgs('work', 'INBOX', 2, 25, { from: 'Alice', unseen: true }), [
    '--json',
    '-a',
    'work',
    'envelope',
    'search',
    '-m',
    'INBOX',
    '-p',
    '2',
    '-s',
    '25',
    'from',
    '"Alice"',
    'and',
    'not',
    'flag',
    'seen',
  ]);
});

void test('filters are checked before they reach an argv: length, control characters and dates', () => {
  assert.equal(filterSchema.safeParse({ from: 'a'.repeat(201) }).success, false);
  assert.equal(filterSchema.safeParse({ subject: 'line\nbreak' }).success, false);
  assert.equal(filterSchema.safeParse({ after: '2026-13-40' }).success, false);
  assert.equal(filterSchema.safeParse({ after: '2026-11-01', unseen: true }).success, true);
});

void test('ids that could be read as an option are refused', () => {
  for (const id of ['-f', '--seen', '', 'a b']) assert.equal(idSchema.safeParse(id).success, false, id);
  assert.equal(idSchema.safeParse('1700000000.1.probe').success, true);
});

void test('a plain text message gives its text', () => {
  assert.equal(plainTextOf(messages['work/310']), 'Buongiorno,\nvorremmo proporle un colloquio.');
});

void test('a multipart message gives its plain text part, never the HTML one', () => {
  assert.equal(plainTextOf(messages['work/308']), 'Versione testo della risposta.');
});

void test('an HTML-only message gives text with no tags, no script or style, and no image', () => {
  const text = plainTextOf(messages['work/309']);
  assert.equal(text, 'Titolo\nPrimo paragrafo & resto.\nSecondo\nriga');
  assert.doesNotMatch(text, /[<>]/);
  assert.doesNotMatch(text, /alert|color|pixel/);
});

void test('hostile markup never leaves the converter as markup', () => {
  const hostile = [
    '<script>steal()</script>ok',
    '<img src="https://example.org/x.png" onerror="steal()">text',
    '<a href="javascript:steal()">link</a>',
    '<style>body{}</style><p>para</p>',
    '<iframe src="https://example.org"></iframe>visible',
  ];
  for (const html of hostile) {
    const text = htmlToText(html);
    assert.doesNotMatch(text, /<\/?[a-z][^>]*>/i, html);
    assert.doesNotMatch(text, /steal|javascript:/, html);
  }
});

const answer =
  (result: RunResult): Run =>
  () =>
    Promise.resolve(result);

void test('the runner reports each way a call can fail as a reason, never as a throw', async () => {
  const schema = envelopesSchema;
  assert.deepEqual(await himalaya(answer({ stdout: '', stderr: 'x', code: 1 }), ['x'], schema), {
    ok: false,
    failure: 'failed',
  });
  assert.deepEqual(await himalaya(answer({ stdout: '', stderr: '', code: -1 }), ['x'], schema), {
    ok: false,
    failure: 'timeout',
  });
  assert.deepEqual(await himalaya(answer({ stdout: '{"error":"no account"}', stderr: '', code: 0 }), ['x'], schema), {
    ok: false,
    failure: 'failed',
  });
  assert.deepEqual(await himalaya(answer({ stdout: 'not json', stderr: '', code: 0 }), ['x'], schema), {
    ok: false,
    failure: 'unreadable',
  });
  assert.deepEqual(
    await himalaya(
      answer({ stdout: '{"queued":0,"envelopes":[{"subject":"no id"}]}', stderr: '', code: 0 }),
      ['x'],
      schema,
    ),
    { ok: false, failure: 'unreadable' },
  );
});

void test('the runner gives the mail timeout and the argv it was asked for', async () => {
  const seen: { bin: string; args: readonly string[]; timeoutMs?: number }[] = [];
  const run: Run = (bin, args, options) => {
    seen.push({ bin, args, timeoutMs: options?.timeoutMs });
    return Promise.resolve({ stdout: '{"queued":0,"envelopes":[]}', stderr: '', code: 0 });
  };
  const result = await himalaya(run, ['--json', '-a', 'work', 'envelope', 'list'], envelopesSchema);
  assert.deepEqual(result, { ok: true, value: { queued: 0, envelopes: [] } });
  assert.deepEqual(seen, [
    { bin: 'himalaya', args: ['--json', '-a', 'work', 'envelope', 'list'], timeoutMs: MAIL_TIMEOUT_MS },
  ]);
});

void test('the envelope fields Hub reads are all in himalaya 2.2.1 schema, and a removed one is named', () => {
  assert.deepEqual(missingEnvelopeFields(schemaText), []);
  const withoutAttachment = JSON.parse(schemaText);
  delete withoutAttachment.$defs.Envelope.properties['has-attachment'];
  assert.deepEqual(missingEnvelopeFields(JSON.stringify(withoutAttachment)), ['has-attachment']);
  assert.equal(missingEnvelopeFields('not a schema'), null);
});

void test('a row tells seen and flagged from himalaya flags, and keeps only the first sender', () => {
  const envelope = envelopesSchema.parse({
    envelopes: [
      {
        id: '1',
        flags: [{ raw: '\\Seen', iana: 'seen' }, { raw: '\\Flagged' }],
        from: [
          { name: 'First', email: 'first@example.org' },
          { name: 'Second', email: 'second@example.org' },
        ],
      },
    ],
  }).envelopes[0];
  assert.ok(envelope);
  assert.deepEqual(toMessage(envelope), {
    id: '1',
    messageId: null,
    subject: '',
    from: { name: 'First', email: 'first@example.org' },
    date: null,
    seen: true,
    flagged: true,
    hasAttachment: null,
  });
});

void test('envelope recipients are parsed and checked against the installed schema', () => {
  const envelope = envelopesSchema.parse({ envelopes: [{ id: '1', to: [{ email: 'person@example.com' }] }] })
    .envelopes[0];
  assert.equal(envelope?.to[0]?.email, 'person@example.com');
  const schema = JSON.parse(schemaText);
  delete schema.$defs.Envelope.properties.to;
  assert.deepEqual(missingEnvelopeFields(JSON.stringify(schema)), ['to']);
});

void test('compose is one argv: each value its own element, a body starting with a dash stays one --body= element', () => {
  assert.deepEqual(
    composeArgs('work', {
      to: ['a@example.org', 'b@example.org'],
      cc: ['c@example.org'],
      subject: 'Ciao',
      body: '-rf x',
    }),
    [
      '--json',
      '-a',
      'work',
      'message',
      'compose',
      '--to=a@example.org',
      '--to=b@example.org',
      '--cc=c@example.org',
      '--subject=Ciao',
      '--body=-rf x',
      '--send',
      '--save',
      'sent',
    ],
  );
});

void test('reply sends with the id last and never builds the threading headers itself; the draft has no --send', () => {
  assert.deepEqual(replyArgs('work', 'INBOX', '310', { to: ['a@example.org'], body: 'Grazie' }), [
    '--json',
    '-a',
    'work',
    'message',
    'reply',
    '-m',
    'INBOX',
    '--to=a@example.org',
    '--body=Grazie',
    '--send',
    '--save',
    'sent',
    '310',
  ]);
  const draft = replyDraftArgs('work', 'INBOX', '310');
  assert.deepEqual(draft, ['--json', '-a', 'work', 'message', 'reply', '-m', 'INBOX', '--body=', '310']);
  assert.equal(draft.includes('--send'), false);
});

void test('moving names the source mailbox and the destination', () => {
  assert.deepEqual(moveArgs('work', 'INBOX', 'archive', ['310']), [
    '--json',
    '-a',
    'work',
    'message',
    'move',
    '-f',
    'INBOX',
    '-t',
    'archive',
    '310',
  ]);
});

void test('outgoing values are bounded before they reach argv', () => {
  assert.equal(recipientsSchema.safeParse(['a@example.org']).success, true);
  assert.equal(recipientsSchema.safeParse(['not an address']).success, false);
  assert.equal(recipientsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `u${i}@example.org`)).success, false);
  assert.equal(subjectSchema.safeParse('una\nriga').success, false);
  assert.equal(subjectSchema.safeParse('x'.repeat(301)).success, false);
  assert.equal(bodySchema.safeParse('x'.repeat(20_001)).success, false);
  assert.equal(bodySchema.safeParse('  \n ').success, false);
  assert.equal(bodySchema.safeParse('a\0b').success, false, 'a NUL cannot be an argv element');
});

void test('himalayaDone ignores the answer and fails on the exit code or an error payload', async () => {
  const answerDone =
    (result: RunResult): Run =>
    () =>
      Promise.resolve(result);
  assert.deepEqual(await himalayaDone(answerDone({ stdout: 'Sent', stderr: '', code: 0 }), []), {
    ok: true,
    value: true,
  });
  assert.deepEqual(await himalayaDone(answerDone({ stdout: '{"error":"x"}', stderr: '', code: 0 }), []), {
    ok: false,
    failure: 'failed',
  });
  assert.deepEqual(await himalayaDone(answerDone({ stdout: '', stderr: '', code: -1 }), []), {
    ok: false,
    failure: 'timeout',
  });
});

void test('fake himalaya answers only valid argv and isolates flag changes per desktop', async () => {
  const calls: string[][] = [];
  const run = createFakeMailRun({ calls });
  const other = createFakeMailRun();
  const refusals = [
    ['--json', '-a', 'work', 'message', 'send'],
    ['--json', '-a', 'work', 'message', 'read', '-m', 'INBOX', '310', '--seen'],
    ['--json', '-a', 'nosuch', 'envelope', 'list', '-m', 'INBOX', '-p', '1', '-s', '25'],
    ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'deleted', '310'],
    ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'seen', '999'],
  ];
  for (const args of refusals) assert.equal((await run('himalaya', args)).code, 127, args.join(' '));
  assert.equal(calls.length, refusals.length);

  const flagsOf = async (runner: Run) =>
    JSON.parse(
      (await runner('himalaya', ['--json', '-a', 'work', 'envelope', 'list', '-m', 'INBOX'])).stdout,
    ).envelopes.find((row: { id: string }) => row.id === '310').flags;
  assert.deepEqual(await flagsOf(run), []);
  assert.equal(
    (await run('himalaya', ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'seen', '310'])).code,
    0,
  );
  assert.deepEqual(await flagsOf(run), [{ raw: '\\Seen', iana: 'seen' }]);
  assert.deepEqual(await flagsOf(other), []);
});
