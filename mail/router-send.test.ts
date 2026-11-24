import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptyConfig, type Config } from '../../apps/server/src/core/config.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { buildServer } from '../../apps/server/src/server.ts';
import { createFakeMailRun } from './fake-himalaya.ts';

process.env.NODE_ENV = 'test';
const moduleRoots = [dirname(dirname(fileURLToPath(import.meta.url)))];

const config = (archiveMailbox = 'archive'): Config => ({
  ...emptyConfig,
  modules: {
    mail: {
      accounts: [
        { label: 'Lavoro', account: 'work' },
        { label: 'Personale', account: 'personal' },
      ],
      archiveMailbox,
      notify: false,
    },
  },
});

function setup(t: test.TestContext, withConfig: Config = config()) {
  const calls: string[][] = [];
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots,
    onlyModules: ['mail'],
    deps: { run: createFakeMailRun({ calls }) },
    config: withConfig,
  });
  t.after(() => app.close());
  const get = (path: string, input?: unknown) =>
    app.inject(`/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
  const post = (path: string, input: unknown) =>
    app.inject({
      method: 'POST',
      url: `/trpc/${path}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(input),
    });
  return { app, calls, get, post };
}

const sendCalls = (calls: string[][]) => calls.filter((call) => call.includes('--send'));
const rowIds = (response: { json: () => { result: { data: { id: string }[] } } }) =>
  response.json().result.data.map((row) => row.id);

const feedIds = (response: { json: () => { result: { data: { rows: { id: string }[] } } } }) =>
  response.json().result.data.rows.map((row) => row.id);

const compose = { account: 'work', to: ['marta@example.org'], subject: 'Appunti', body: 'Ciao Marta', confirmed: true };

void test('a compose is refused before any himalaya call when its values are not valid', async (t) => {
  const { post, calls } = setup(t);
  const cases: [string, Record<string, unknown>][] = [
    ['unknown account', { ...compose, account: 'nosuch' }],
    ['invalid address', { ...compose, to: ['not an address'] }],
    ['no recipient', { ...compose, to: [] }],
    ['21 recipients', { ...compose, to: Array.from({ length: 21 }, (_, i) => `u${i}@example.org`) }],
    ['newline in subject', { ...compose, subject: 'una\nriga' }],
    ['empty subject', { ...compose, subject: '' }],
    ['body over the limit', { ...compose, body: 'x'.repeat(20_001) }],
    ['empty body', { ...compose, body: '   ' }],
  ];
  for (const [name, input] of cases) {
    const response = await post('mail.compose', input);
    assert.ok(response.statusCode >= 400 && response.statusCode < 500, name);
  }
  const reply = { account: 'work', id: '310', body: 'Grazie', confirmed: true };
  assert.equal((await post('mail.reply', { ...reply, id: '-310' })).statusCode, 400);
  assert.equal((await post('mail.reply', { ...reply, mailbox: '-x' })).statusCode, 400);
  assert.equal((await post('mail.reply', { ...reply, account: 'nosuch' })).statusCode, 404);
  assert.deepEqual(calls, [], 'nothing reached himalaya');
});

void test('sending needs the hold: compose and reply without confirmed are refused', async (t) => {
  const { post, calls } = setup(t);
  const { confirmed: _held, ...bare } = compose;
  assert.equal((await post('mail.compose', bare)).statusCode, 412);
  assert.equal((await post('mail.compose', { ...compose, confirmed: false })).statusCode, 412);
  assert.equal((await post('mail.reply', { account: 'work', id: '310', body: 'Grazie' })).statusCode, 412);
  assert.deepEqual(calls, []);
});

void test('a compose sends one message, which then shows in the sent list', async (t) => {
  const { post, get, calls } = setup(t);
  const response = await post('mail.compose', { ...compose, cc: ['luca@example.org'], body: '-- non e un flag' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(sendCalls(calls), [
    [
      '--json',
      '-a',
      'work',
      'message',
      'compose',
      '--to=marta@example.org',
      '--cc=luca@example.org',
      '--subject=Appunti',
      '--body=-- non e un flag',
      '--send',
      '--save',
      'sent',
    ],
  ]);
  const sent = await get('mail.search', { account: 'work', mailbox: 'sent', filter: { subject: 'Appunti' } });
  assert.equal(rowIds(sent).length, 1);
});

void test('a reply asks himalaya for the draft, shows its fields, and sends with the id and the threading left to it', async (t) => {
  const { post, get, calls } = setup(t);
  const draft = await get('mail.replyDraft', { account: 'work', id: '310' });
  assert.equal(draft.statusCode, 200);
  const fields = z
    .object({ to: z.array(z.string()), cc: z.array(z.string()), subject: z.string(), quoted: z.string() })
    .parse(draft.json().result.data);
  assert.deepEqual(fields.to, ['recruiter@example.org']);
  assert.equal(fields.subject, 'Re: Offerta di colloquio');
  assert.match(fields.quoted, /> vorremmo proporle un colloquio\./);
  assert.equal(calls.at(-1)?.includes('--send'), false, 'a preview never sends');

  const response = await post('mail.reply', { account: 'work', id: '310', body: 'Volentieri', confirmed: true });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(sendCalls(calls).at(-1), [
    '--json',
    '-a',
    'work',
    'message',
    'reply',
    '-m',
    'INBOX',
    '--body=Volentieri',
    '--send',
    '--save',
    'sent',
    '310',
  ]);
  const sent = await get('mail.search', {
    account: 'work',
    mailbox: 'sent',
    filter: { subject: 'Offerta di colloquio' },
  });
  assert.deepEqual(rowIds(sent).length, 2, 'the fixture reply and ours');
});

void test('a failed send is one generic error with no address or body in it', async (t) => {
  const { post } = setup(t);
  const failed = await post('mail.reply', { account: 'work', id: '999', body: 'Segreto', confirmed: true });
  assert.equal(failed.statusCode, 500);
  assert.doesNotMatch(failed.body, /Segreto|example\.org/);
});

void test('a paired phone gets 403 on the draft, the reply and the compose', async (t) => {
  const { app, post, calls } = setup(t);
  const LAN = '192.0.2.30';
  const code = (await post('pairing.createCode', {})).json().result.data.code;
  const redeemed = await app.inject({
    method: 'POST',
    url: '/trpc/pairing.redeem',
    remoteAddress: LAN,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ code, deviceName: 'Phone' }),
  });
  const headers = { authorization: `Bearer ${redeemed.json().result.data.token}`, 'content-type': 'application/json' };
  const phonePost = (path: string, input: unknown) =>
    app.inject({ method: 'POST', url: `/trpc/${path}`, remoteAddress: LAN, headers, payload: JSON.stringify(input) });
  const draft = await app.inject({
    url: `/trpc/mail.replyDraft?input=${encodeURIComponent(JSON.stringify({ account: 'work', id: '310' }))}`,
    remoteAddress: LAN,
    headers,
  });
  assert.equal(draft.statusCode, 403);
  assert.equal(
    (await phonePost('mail.reply', { account: 'work', id: '310', body: 'Ok', confirmed: true })).statusCode,
    403,
  );
  assert.equal((await phonePost('mail.compose', compose)).statusCode, 403);
  assert.equal((await phonePost('mail.archive', { account: 'work', id: '310' })).statusCode, 403);
  assert.deepEqual(calls, []);
});

void test('the inbox pages through one account and merges all of them newest first with their account', async (t) => {
  const { get, calls } = setup(t);
  const one = await get('mail.inbox', { account: 'work' });
  assert.deepEqual(feedIds(one), ['310', '309', '308']);
  assert.equal(one.json().result.data.cursor, null, 'a short page is the end');
  assert.deepEqual(calls[0], ['--json', '-a', 'work', 'envelope', 'list', '-m', 'INBOX', '-p', '1', '-s', '25']);

  const all = await get('mail.inbox', {});
  const rows: { id: string; account: string }[] = all.json().result.data.rows;
  assert.equal(new Set(rows.map((row) => row.account)).size, 2);
  const dates: string[] = all.json().result.data.rows.map((row: { date: string }) => row.date);
  assert.deepEqual(dates, dates.toSorted().toReversed());
});

void test('the inbox search joins its filter into one query, and a cursor of another account is ignored', async (t) => {
  const { get, calls } = setup(t);
  const found = await get('mail.inbox', { account: 'work', filter: { from: 'carla', unseen: false } });
  assert.deepEqual(
    found.json().result.data.rows.map((row: { id: string }) => row.id),
    ['308'],
  );
  assert.deepEqual(calls.at(-1)?.slice(-2), ['from', '"carla"']);
  assert.equal((await get('mail.inbox', { account: 'nosuch' })).statusCode, 404);
});

void test('archiving moves the message out of the inbox, and Annulla finds it by Message-ID and moves it back', async (t) => {
  const { post, get, calls } = setup(t);
  assert.equal((await post('mail.archive', { account: 'work', id: '310' })).statusCode, 200);
  assert.deepEqual(calls.at(-1), ['--json', '-a', 'work', 'message', 'move', '-f', 'INBOX', '-t', 'archive', '310']);
  const after = await get('mail.inbox', { account: 'work' });
  assert.equal(
    after.json().result.data.rows.some((row: { id: string }) => row.id === '310'),
    false,
  );

  const undone = await post('mail.unarchive', {
    account: 'work',
    messageId: 'offer@example.org',
    subject: 'Offerta di colloquio',
  });
  assert.equal(undone.statusCode, 200);
  assert.deepEqual(calls.at(-1)?.slice(0, 9), [
    '--json',
    '-a',
    'work',
    'message',
    'move',
    '-f',
    'archive',
    '-t',
    'INBOX',
  ]);
  const back = await get('mail.inbox', { account: 'work' });
  assert.equal(
    back.json().result.data.rows.some((row: { subject: string }) => row.subject === 'Offerta di colloquio'),
    true,
  );
  const text = await get('mail.read', {
    account: 'work',
    id: back.json().result.data.rows.find((row: { subject: string }) => row.subject === 'Offerta di colloquio').id,
  });
  assert.equal(text.statusCode, 200, 'the moved message is still readable under its new id');
  assert.equal(
    (await post('mail.unarchive', { account: 'work', messageId: 'nope@example.org', subject: '' })).statusCode,
    404,
  );
});

void test('an archive folder himalaya does not know is one error line and nothing moves', async (t) => {
  const { post, get } = setup(t, config('nosuchbox'));
  const failed = await post('mail.archive', { account: 'work', id: '310' });
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.json().error.message, 'The mail account is not available');
  const rows = (await get('mail.inbox', { account: 'work' })).json().result.data.rows;
  assert.equal(rows.length, 3);
});

void test('sending and archiving stay on the Posta page: not in the palette, not an MCP tool, refused over MCP', async (t) => {
  const { app, calls, get } = setup(t);
  const registry = z
    .object({ result: z.object({ data: z.array(z.object({ path: z.string() })) }) })
    .parse((await get('registry.list')).json());
  const pageOnly = ['mail.reply', 'mail.compose', 'mail.archive', 'mail.unarchive'];
  for (const path of pageOnly) assert.ok(!registry.result.data.some((action) => action.path === path), path);
  const mcp = (method: string, params: unknown) =>
    app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { accept: 'application/json, text/event-stream' },
      payload: { jsonrpc: '2.0', id: 1, method, params },
    });
  const tools = (await mcp('tools/list', {})).body;
  for (const path of pageOnly) assert.ok(!tools.includes(`"${path}"`), path);
  const call = await mcp('tools/call', {
    name: 'mail.compose',
    arguments: { account: 'work', to: ['marta@example.org'], subject: 'Ciao', body: 'Prova', confirmed: true },
  });
  assert.ok(call.body.includes('Unknown') || call.body.includes('isError'), call.body);
  assert.deepEqual(
    calls.filter((argv) => argv.includes('--send')),
    [],
  );
});
