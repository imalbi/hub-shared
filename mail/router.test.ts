import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDeviceSockets } from '../../apps/server/src/core/auth.ts';
import { emptyConfig, type Config } from '../../apps/server/src/core/config.ts';
import type { Run, RunResult } from '../../apps/server/src/core/exec.ts';
import { createFiles } from '../../apps/server/src/core/files.ts';
import { createFocusHistory } from '../../apps/server/src/core/focus-history.ts';
import { createJobRunner } from '../../apps/server/src/core/jobs.ts';
import { createCapabilityRegistry, z, type DiscoveredDeps } from '../../apps/server/src/core/module.ts';
import { openDb } from '../../apps/server/src/db/index.ts';
import { buildServer } from '../../apps/server/src/server.ts';
import { createFakeMailRun } from './fake-himalaya.ts';
import { createMailLive } from './live.ts';
import { mailModule } from './module.ts';
import { createMailRouter, logThreadFailure } from './router.ts';

const noop = () => undefined;
const silentLog: DiscoveredDeps['log'] = {
  level: 'info',
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  silent: noop,
  child: () => silentLog,
};

process.env.NODE_ENV = 'test';
const moduleRoots = [dirname(dirname(fileURLToPath(import.meta.url)))];

const withMail: Config = {
  ...emptyConfig,
  modules: {
    mail: {
      accounts: [
        { label: 'Lavoro', account: 'work' },
        { label: 'Personale', account: 'personal' },
      ],
      archiveMailbox: 'archive',
      // The notifier's own poll would add a call to every list the tests read; notify.test.ts covers it.
      notify: false,
    },
  },
};

function setup(
  t: test.TestContext,
  config: Config = withMail,
  run?: Run,
  extra?: { isLoopback?: (req: { headers: Record<string, string | string[] | undefined> }) => boolean },
) {
  const calls: string[][] = [];
  const effectiveRun = run ?? createFakeMailRun({ calls });
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots,
    onlyModules: ['mail'],
    deps: { run: effectiveRun },
    config,
    ...extra,
  });
  t.after(() => app.close());
  const get = (path: string, input?: unknown) =>
    app.inject(
      input === undefined ? `/trpc/${path}` : `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
    );
  const post = (path: string, input: unknown) =>
    app.inject({
      method: 'POST',
      url: `/trpc/${path}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(input),
    });
  return { app, calls, run: effectiveRun, get, post };
}

const ids = (response: { json: () => { result: { data: { id: string }[] } } }) =>
  response.json().result.data.map((row) => row.id);

const failing =
  (result: RunResult): Run =>
  () =>
    Promise.resolve(result);

void test('mail registers MailCapability when configured and stays silent when absent', async () => {
  const coreDb = openDb(':memory:');
  const offRegistry = createCapabilityRegistry();
  mailModule.create({
    config: undefined,
    run: createFakeMailRun(),
    fetch,
    log: silentLog,
    zones: new Set(),
    focusHistory: createFocusHistory(coreDb),
    capabilities: offRegistry,
  });
  assert.equal(offRegistry.get('mail'), undefined);

  const onRegistry = createCapabilityRegistry();
  const instance = mailModule.create({
    config: {
      accounts: [{ label: 'Lavoro', account: 'work' }],
      archiveMailbox: 'archive',
      notify: false,
    },
    run: createFakeMailRun(),
    fetch,
    log: silentLog,
    zones: new Set(),
    focusHistory: createFocusHistory(coreDb),
    capabilities: onRegistry,
  });
  try {
    const cap = onRegistry.get('mail');
    assert.ok(cap);
    assert.deepEqual(cap.accounts(), [{ label: 'Lavoro', account: 'work' }]);
    const { entries } = await cap.listThreadEntries('work', '2026-09-01');
    assert.ok(entries.some((entry) => entry.messageId === 'offer@example.org'));
    assert.equal(await cap.readMessageText('work', 'INBOX', '310'), 'Buongiorno,\nvorremmo proporle un colloquio.');
    assert.ok(cap.threadOf(entries, 'offer@example.org'));
  } finally {
    await instance.close?.();
    coreDb.$client.close();
  }
});

void test('a thread failure log includes only its kind and account label', () => {
  const calls: unknown[] = [];
  logThreadFailure({ warn: (fields: unknown, message: string) => calls.push({ fields, message }) }, 'timeout', 'Work');
  assert.deepEqual(calls, [{ fields: { kind: 'timeout', account: 'Work' }, message: 'Mail thread unavailable' }]);
});

void test('a listing asks for one page of the mailbox and gives its rows, newest first', async (t) => {
  const { get, calls } = setup(t);
  const first = await get('mail.list', { account: 'work' });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(ids(first), ['310', '309', '308']);
  assert.deepEqual(calls[0], ['--json', '-a', 'work', 'envelope', 'list', '-m', 'INBOX', '-p', '1', '-s', '25']);
  const second = await get('mail.list', { account: 'work', page: 2 });
  assert.deepEqual(calls[1], ['--json', '-a', 'work', 'envelope', 'list', '-m', 'INBOX', '-p', '2', '-s', '25']);
  assert.deepEqual(ids(second), []);
});

void test('reading a message asks for it without --seen, returns its text, and leaves it unread', async (t) => {
  const { get, calls } = setup(t);
  const read = await get('mail.read', { account: 'work', id: '310' });
  assert.equal(read.statusCode, 200, 'the fake refuses --seen, so a read that sent it would fail here');
  assert.deepEqual(calls.at(-1), ['--json', '-a', 'work', 'message', 'read', '-m', 'INBOX', '310']);
  assert.equal(calls.flat().includes('--seen'), false);
  assert.deepEqual(read.json().result.data, {
    id: '310',
    text: 'Buongiorno,\nvorremmo proporle un colloquio.',
    truncated: false,
  });
  const after = await get('mail.list', { account: 'work' });
  assert.equal(after.json().result.data.find((row: { id: string }) => row.id === '310').seen, false);
});

void test('marking seen and starred asks for the flag and shows in the next listing', async (t) => {
  const { post, get, calls } = setup(t);
  assert.equal((await post('mail.setSeen', { account: 'work', ids: ['310'], seen: true })).statusCode, 200);
  assert.deepEqual(calls.at(-1), ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'seen', '310']);
  const seen = await get('mail.list', { account: 'work' });
  assert.equal(seen.json().result.data.find((row: { id: string }) => row.id === '310').seen, true);

  assert.equal((await post('mail.setSeen', { account: 'work', ids: ['310'], seen: false })).statusCode, 200);
  assert.deepEqual(calls.at(-1), ['--json', '-a', 'work', 'flag', 'remove', '-m', 'INBOX', '-f', 'seen', '310']);

  assert.equal((await post('mail.setFlagged', { account: 'work', ids: ['310'], flagged: true })).statusCode, 200);
  assert.deepEqual(calls.at(-1), ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'flagged', '310']);
  const starred = await get('mail.list', { account: 'work' });
  assert.equal(starred.json().result.data.find((row: { id: string }) => row.id === '310').flagged, true);
});

void test('search narrows by sender, by an unread flag and by a subject with spaces, as one token each', async (t) => {
  const { get, calls } = setup(t);
  assert.deepEqual(ids(await get('mail.search', { account: 'work', filter: { from: 'carla' } })), ['308']);
  assert.deepEqual(calls.at(-1)?.slice(-2), ['from', '"carla"']);
  assert.deepEqual(ids(await get('mail.search', { account: 'work', filter: { unseen: true } })), ['310', '308']);
  assert.deepEqual(ids(await get('mail.search', { account: 'work', filter: { subject: 'Offerta di colloquio' } })), [
    '310',
  ]);
  const literal = await get('mail.search', { account: 'work', filter: { subject: 'Offerta and dintorni' } });
  assert.equal(literal.statusCode, 200);
  assert.deepEqual(ids(literal), []);
});

void test('search uses the requested mailbox and defaults to INBOX', async (t) => {
  const { get, calls } = setup(t);
  assert.equal(
    (await get('mail.search', { account: 'work', filter: { subject: 'Offerta' }, mailbox: 'sent' })).statusCode,
    200,
  );
  assert.equal(calls.at(-1)?.[6], 'sent');
  assert.equal((await get('mail.search', { account: 'work', filter: { subject: 'Offerta' } })).statusCode, 200);
  assert.equal(calls.at(-1)?.[6], 'INBOX');
});

void test('a himalaya failure is a generic error, with no address, subject or body in the answer', async (t) => {
  const exited = setup(t, withMail, failing({ stdout: '', stderr: 'owner@example.org Offerta', code: 1 }));
  const list = await exited.get('mail.list', { account: 'work' });
  assert.equal(list.statusCode, 500);
  assert.equal(list.json().error.message, 'The mail account is not available');
  assert.doesNotMatch(list.body, /example\.org|Offerta/);

  const timed = setup(t, withMail, failing({ stdout: '', stderr: '', code: -1 }));
  assert.equal((await timed.get('mail.list', { account: 'work' })).statusCode, 408);

  const garbled = setup(t, withMail, failing({ stdout: 'Offerta di colloquio, not json', stderr: '', code: 0 }));
  const bad = await garbled.get('mail.read', { account: 'work', id: '310' });
  assert.equal(bad.statusCode, 500);
  assert.equal(bad.json().error.message, 'The mail account answered unexpectedly');
  assert.doesNotMatch(bad.body, /Offerta/);
});

void test('the state keeps a failed account as an error row, and the answer stays free of addresses', async (t) => {
  const { get } = setup(t, withMail, failing({ stdout: '', stderr: '', code: 1 }));
  const state = await get('mail.state', undefined);
  assert.equal(state.statusCode, 200);
  assert.deepEqual(
    state
      .json()
      .result.data.accounts.map((account: { unread: unknown; failure: string; latest: unknown[] }) => [
        account.unread,
        account.failure,
        account.latest,
      ]),
    [
      [null, 'failed', []],
      [null, 'failed', []],
    ],
  );
  assert.doesNotMatch(state.body, /example\.org/);
});

void test('without a mail slice the module answers nothing, and an account it does not know is refused', async (t) => {
  const off = setup(t, emptyConfig);
  assert.equal((await off.get('mail.state', undefined)).statusCode, 404);
  assert.equal((await off.get('mail.list', { account: 'work' })).statusCode, 404);
  assert.deepEqual(off.calls, []);

  const unknown = setup(t);
  const refused = await unknown.get('mail.list', { account: 'nosuch' });
  assert.equal(refused.statusCode, 404);
  assert.equal(refused.json().error.message, 'Mail account not configured');
  assert.equal((await unknown.post('mail.setSeen', { account: 'nosuch', ids: ['1'], seen: true })).statusCode, 404);
  assert.deepEqual(unknown.calls, []);
});

void test('the two flag actions are in the registry with their Italian label and English description', async (t) => {
  const { app } = setup(t);
  const actions = z
    .array(z.object({ path: z.string(), label: z.string(), description: z.string() }))
    .parse((await app.inject('/trpc/registry.list')).json().result.data);
  for (const path of ['mail.setSeen', 'mail.setFlagged']) {
    const action = actions.find((item) => item.path === path);
    assert.ok(action?.label.trim(), path);
    assert.ok(action?.description.trim(), path);
  }
});

void test('a thread is rebuilt from both mailboxes over the window, starting the day before it', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 12) });
  t.after(() => mock.timers.reset());
  const { get, calls } = setup(t);
  const response = await get('mail.threads', {
    links: [
      { account: 'work', messageId: 'ask@example.org' },
      { account: 'work', messageId: 'offer@example.org' },
      { account: 'work', messageId: 'missing@example.org' },
    ],
    days: 60,
  });
  assert.equal(response.statusCode, 200);
  const answer = response.json().result.data;
  assert.equal(answer.after, '2026-09-09');
  assert.equal(answer.truncated, false);
  const [question, offer, missing] = answer.threads;
  assert.deepEqual(
    question.thread.messages.map((message: { id: string }) => message.id),
    ['42', '308'],
  );
  assert.equal(question.thread.waiting, false);
  assert.deepEqual(
    offer.thread.messages.map((message: { id: string }) => message.id),
    ['310', '43'],
  );
  assert.equal(offer.thread.waiting, true);
  assert.equal(missing.thread, null);
  assert.ok(calls.some((call) => call.includes('after') && call.includes('2026-09-09')));
  assert.ok(calls.some((call) => call.join(' ').includes('-m sent')));
});

void test('an archived linked message remains readable by its Message-ID', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 12) });
  t.after(() => mock.timers.reset());
  const { get, post } = setup(t);
  assert.equal((await post('mail.archive', { account: 'work', id: '310', confirmed: true })).statusCode, 200);
  const result = await get('mail.threads', { links: [{ account: 'work', messageId: 'offer@example.org' }] });
  const thread = result.json().result.data.threads[0].thread;
  assert.ok(thread);
  const moved = thread.messages.find((message: { messageId: string }) => message.messageId === 'offer@example.org');
  assert.ok(moved);
  assert.notEqual(moved.id, '310');
  assert.equal((await get('mail.read', { account: 'work', id: moved.id, mailbox: moved.folder })).statusCode, 200);
});

void test('threads report account, timeout and missing separately', async (t) => {
  const desktop = createFakeMailRun();
  const run: Run = (bin, args, options) => {
    if (args.includes('personal')) return Promise.resolve({ stdout: '', stderr: '', code: -1 });
    return desktop(bin, args, options);
  };
  const { get } = setup(t, withMail, run);
  const response = await get('mail.threads', {
    links: [
      { account: 'work', messageId: 'missing@example.org' },
      { account: 'personal', messageId: 'timeout@example.org' },
      { account: 'unknown', messageId: 'account@example.org' },
    ],
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    response.json().result.data.threads.map((entry: { status: string }) => entry.status),
    ['missing', 'timeout', 'account'],
  );
});

void test('a legacy envelope ID resolves only when it identifies a single message', async (t) => {
  mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 12) });
  t.after(() => mock.timers.reset());
  const { get } = setup(t);
  const response = await get('mail.threads', { links: [{ account: 'work', messageId: '310' }] });
  const result = response.json().result.data.threads[0];
  assert.equal(result.resolvedMessageId, 'offer@example.org');
  assert.ok(result.thread);
});

void test('a paired phone gets the unread state but never the content of the mail', async (t) => {
  const { app, get, post } = setup(t);
  const LAN = '192.0.2.30';
  const code = (await post('pairing.createCode', {})).json().result.data.code;
  const redeemed = await app.inject({
    method: 'POST',
    url: '/trpc/pairing.redeem',
    remoteAddress: LAN,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ code, deviceName: 'Phone' }),
  });
  const token: string = redeemed.json().result.data.token;
  const fromPhone = (path: string, input: unknown) =>
    app.inject({
      url: input === undefined ? `/trpc/${path}` : `/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
      remoteAddress: LAN,
      headers: { authorization: `Bearer ${token}` },
    });
  const phoneState = await fromPhone('mail.state', undefined);
  assert.equal(phoneState.statusCode, 200);
  // The count reaches the phone, the senders and subjects of the latest rows do not.
  const phoneAccounts: { unread: number | null; latest: unknown[] }[] = phoneState.json().result.data.accounts;
  assert.ok(phoneAccounts.some((account) => account.unread !== null && account.unread > 0));
  assert.ok(phoneAccounts.every((account) => account.latest.length === 0));
  // Nor does it learn the account names or labels, from the state or from the account list.
  assert.ok(!phoneState.body.includes('work') && !phoneState.body.includes('Lavoro'));
  const phoneList = await fromPhone('mail.accounts', undefined);
  assert.equal(phoneList.json().result.data.length, 2);
  assert.ok(!/work|personal|Lavoro|Personale/.test(phoneList.body));
  const pcAccounts: { latest: unknown[] }[] = (await get('mail.state', undefined)).json().result.data.accounts;
  assert.ok(pcAccounts.some((account) => account.latest.length > 0));
  for (const [path, input] of [
    ['mail.list', { account: 'work' }],
    ['mail.search', { account: 'work', filter: { subject: 'Offerta' } }],
    ['mail.searchRecords', { query: 'Offerta' }],
    ['mail.read', { account: 'work', id: '310' }],
    ['mail.threads', { links: [{ account: 'work', messageId: '<a@example.com>' }] }],
  ] as const)
    assert.equal((await fromPhone(path, input)).statusCode, 403, path);
  // The PC still reads it.
  assert.equal((await get('mail.list', { account: 'work' })).statusCode, 200);
});

void test('the configured accounts are listed without running himalaya, so the UI can check for Posta on every page', async (t) => {
  const { calls, get } = setup(t);
  const response = await get('mail.accounts');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().result.data, [
    { account: 'work', label: 'Lavoro' },
    { account: 'personal', label: 'Personale' },
  ]);
  assert.equal(calls.length, 0);
});

void test('thread links share a stable key using inbox sender and sent recipient from the listing', async (t) => {
  const run: Run = (_bin, args) =>
    Promise.resolve({
      code: 0,
      stderr: '',
      stdout: JSON.stringify({
        envelopes: args.includes('sent')
          ? [
              {
                id: '2',
                'message-id': 'b@example.com',
                subject: 'Accepted: Meeting',
                to: [{ email: 'PERSON@example.com' }],
                date: '2026-11-02',
              },
            ]
          : [
              {
                id: '1',
                'message-id': 'a@example.com',
                subject: 'Meeting',
                from: [{ email: 'person@example.com' }],
                date: '2026-11-01',
              },
            ],
      }),
    });
  const { get } = setup(t, withMail, run);
  const result = await get('mail.threads', {
    links: [
      { account: 'work', messageId: 'a@example.com' },
      { account: 'work', messageId: 'b@example.com' },
    ],
  });
  assert.equal(result.statusCode, 200);
  const [first, second] = result.json().result.data.threads;
  assert.equal(first.thread.key, 'a@example.com');
  assert.equal(second.thread.key, first.thread.key);
  assert.equal(second.thread.messages.length, 2);
  assert.equal(second.thread.messages[1].counterpart, 'person@example.com');
});

void test('searchRecords finds subjects in every account, newest first, cut at 3 with the full count', async (t) => {
  const { get, calls } = setup(t);
  const all = (await get('mail.searchRecords', { query: 'o' })).json().result.data;
  assert.equal(all.total, 4);
  assert.deepEqual(
    all.rows.map((row: { account: string; id: string; label: string }) => [row.account, row.id, row.label]),
    [
      ['work', '310', 'Lavoro'],
      ['personal', '88', 'Personale'],
      ['work', '309', 'Lavoro'],
    ],
  );
  const one = (await get('mail.searchRecords', { query: 'iscrizione' })).json().result.data;
  assert.deepEqual([one.total, one.rows[0].id], [1, '88']);
  assert.ok(calls.some((call) => call.join(' ').includes('envelope search -m INBOX -p 1 -s 25 subject "iscrizione"')));
  assert.equal((await get('mail.searchRecords', { query: '' })).statusCode, 400);
});

void test('searchRecords keeps the answering accounts when another one fails, and fails when none answers', async (t) => {
  const desktop = createFakeMailRun();
  const run: Run = (bin, args, options) =>
    args.includes('personal') ? Promise.resolve({ stdout: '', stderr: 'boom', code: 1 }) : desktop(bin, args, options);
  const { get } = setup(t, withMail, run);
  const partial = (await get('mail.searchRecords', { query: 'o' })).json().result.data;
  assert.deepEqual(
    partial.rows.map((row: { id: string }) => row.id),
    ['310', '309', '308'],
  );
  const down = setup(t, withMail, failing({ stdout: '', stderr: 'boom', code: 1 }));
  assert.equal((await down.get('mail.searchRecords', { query: 'o' })).statusCode, 500);
});

void test('refreshing mail pushes unread counts on onState and anonymizes paired devices', async () => {
  const coreDb = openDb(':memory:');
  const files = createFiles();
  const jobs = createJobRunner(coreDb, () => ({ kill() {} }), 2);
  const run = createFakeMailRun();
  const accounts = [{ label: 'Lavoro', account: 'work' }];
  const router = createMailRouter({
    run,
    accounts,
    archiveMailbox: 'archive',
    live: createMailLive(run, accounts),
    log: silentLog,
  });
  const baseCtx = {
    db: coreDb,
    files,
    jobs,
    run,
    config: emptyConfig,
    remoteAddress: '127.0.0.1',
    sockets: createDeviceSockets(),
    restart: () => false,
  };
  const pcCaller = router.createCaller({ ...baseCtx, client: { kind: 'loopback' } });
  const phoneCaller = router.createCaller({
    ...baseCtx,
    client: { kind: 'device', deviceId: 1 },
  });
  const pcSub = (await pcCaller.onState(undefined))[Symbol.asyncIterator]();
  const phoneSub = (await phoneCaller.onState(undefined))[Symbol.asyncIterator]();
  try {
    const first = (await pcSub.next()).value;
    assert.equal(first?.accounts[0]?.unread, 2);
    assert.ok((first?.accounts[0]?.latest.length ?? 0) > 0);

    assert.equal(
      (await run('himalaya', ['--json', '-a', 'work', 'flag', 'add', '-m', 'INBOX', '-f', 'seen', '310'])).code,
      0,
    );
    await pcCaller.refresh({});
    const second = (await pcSub.next()).value;
    assert.equal(second?.accounts[0]?.unread, 1);

    const phoneState = (await phoneSub.next()).value;
    assert.equal(phoneState?.accounts[0]?.unread, 1);
    assert.deepEqual(phoneState?.accounts[0]?.latest, []);
    assert.equal(phoneState?.accounts[0]?.label, '');
  } finally {
    await pcSub.return?.();
    await phoneSub.return?.();
    jobs.close();
    await files.close();
    coreDb.$client.close();
  }
});
