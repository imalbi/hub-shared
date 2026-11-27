import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createCapabilityRegistry, type NewMailEvent } from '../../apps/server/src/core/module.ts';
import { createFocusHistory } from '../../apps/server/src/core/focus-history.ts';
import { openDb } from '../../apps/server/src/db/index.ts';
import { mailModule } from './module.ts';
import { emptyConfig, type Config } from '../../apps/server/src/core/config.ts';
import type { Run } from '../../apps/server/src/core/exec.ts';
import { buildServer } from '../../apps/server/src/server.ts';
import { createFakeMailRun } from './fake-himalaya.ts';
import type { MailMessage } from './himalaya.ts';
import { MAIL_POLL_MS, type MailAccountState, type MailSnapshot } from './live.ts';
import { createNewMailNotifier } from './notify.ts';

process.env.NODE_ENV = 'test';
const moduleRoots = [dirname(dirname(fileURLToPath(import.meta.url)))];
afterEach(() => mock.timers.reset());

const row = (id: string, subject: string, seen = false): MailMessage => ({
  id,
  messageId: null,
  subject,
  from: { name: `Mittente ${id}`, email: `${id}@example.org` },
  date: null,
  seen,
  flagged: false,
  hasAttachment: null,
});
const account = (
  name: string,
  latest: MailMessage[],
  failure: MailAccountState['failure'] = null,
): MailSnapshot['accounts'][number] => ({
  account: name,
  label: name,
  unread: failure ? null : latest.filter((message) => !message.seen).length,
  capped: false,
  failure,
  latest: latest.slice(0, 10),
  window: latest,
});
const state = (...accounts: MailSnapshot['accounts']): MailSnapshot => ({ accounts });

function notifier() {
  const sent: string[][] = [];
  const run: Run = (bin, args) => {
    sent.push([bin, ...args]);
    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
  };
  return { sent, observe: createNewMailNotifier(run) };
}

void test('the first read only records; a new unread id sends one notification with sender and subject, once', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', [row('1', 'Vecchia')])));
  assert.deepEqual(sent, [], 'no burst at boot');
  observe(state(account('work', [row('2', 'Offerta di colloquio'), row('1', 'Vecchia')])));
  assert.deepEqual(sent, [
    ['notify-send', '--app-name', 'Hub', '--', 'Nuova mail', 'Mittente 2: Offerta di colloquio'],
  ]);
  observe(state(account('work', [row('2', 'Offerta di colloquio'), row('1', 'Vecchia')])));
  assert.equal(sent.length, 1, 'the same id again sends nothing');
});

void test('notify-send separates options with -- and escapes markup characters in sender and subject', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', [])));
  observe(
    state(
      account('work', [
        {
          id: '9',
          messageId: null,
          subject: 'A & B <script>alert(1)</script>',
          from: { name: '--help <b>x</b>', email: 'a@example.org' },
          date: null,
          seen: false,
          flagged: false,
          hasAttachment: null,
        },
      ]),
    ),
  );
  assert.deepEqual(sent, [
    [
      'notify-send',
      '--app-name',
      'Hub',
      '--',
      'Nuova mail',
      '--help &lt;b&gt;x&lt;/b&gt;: A &amp; B &lt;script&gt;alert(1)&lt;/script&gt;',
    ],
  ]);
});

void test('a new message that is already read, or a read that failed, sends nothing and keeps what was known', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', [row('1', 'A')])));
  observe(state(account('work', [row('2', 'Letta', true), row('1', 'A')])));
  observe(state(account('work', [], 'failed')));
  observe(state(account('work', [row('1', 'A'), row('2', 'Letta', true)])));
  assert.deepEqual(sent, []);
});

void test('a long subject is cut at 80 characters', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', [])));
  observe(state(account('work', [row('1', 'x'.repeat(200))])));
  const body = sent[0]?.[5] ?? '';
  assert.equal(body.length, 'Mittente 1: '.length + 80);
  assert.ok(body.endsWith('...'));
});

void test('four new at once are one notification', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', []), account('personal', [])));
  observe(state(account('work', [row('1', 'A'), row('2', 'B'), row('3', 'C')]), account('personal', [row('4', 'D')])));
  assert.deepEqual(sent, [['notify-send', '--app-name', 'Hub', '--', 'Nuova mail', '4 nuove mail']]);
});

void test('an old unread row sliding into the window after an archive sends nothing; a newer one still does', () => {
  const { sent, observe } = notifier();
  const dated = (id: number): MailMessage => ({
    ...row(String(id), `Oggetto ${id}`),
    date: new Date(Date.UTC(2026, 10, 15 - id)).toISOString(),
  });
  const rows = Array.from({ length: 11 }, (_, id) => dated(id));
  observe(state(account('work', rows)));
  observe(state(account('work', rows.slice(1, 11))));
  assert.deepEqual(sent, [], 'row 10 is weeks old: row 0 was archived, nothing arrived');
  observe(state(account('work', [{ ...dated(0), id: 'new', date: '2026-11-16T00:00:00Z' }, ...rows.slice(1, 10)])));
  assert.equal(sent.length, 1);
});

const config = (notify: boolean): Config => ({
  ...emptyConfig,
  modules: {
    mail: { accounts: [{ label: 'Lavoro', account: 'work' }], archiveMailbox: 'archive', notify },
  },
});

void test('with notify off the module polls nothing without a client', async (t) => {
  mock.timers.enable({ apis: ['setInterval'] });
  const calls: string[][] = [];
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots,
    onlyModules: ['mail'],
    deps: { run: createFakeMailRun({ calls }) },
    config: config(false),
  });
  t.after(() => app.close());
  await app.ready();
  await flush();
  mock.timers.tick(MAIL_POLL_MS * 3);
  await flush();
  assert.deepEqual(calls, []);
});

void test('with notify on the module polls every minute with no client, and closing it ends the poll', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const calls: string[][] = [];
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots,
    onlyModules: ['mail'],
    deps: { run: createFakeMailRun({ calls }) },
    config: config(true),
  });
  await app.ready();
  await flush();
  await flush();
  assert.equal(calls.length, 1, 'the first read starts with the module');
  mock.timers.tick(MAIL_POLL_MS);
  await flush();
  await flush();
  assert.equal(calls.length, 2);
  await app.close();
  mock.timers.tick(MAIL_POLL_MS * 3);
  await flush();
  assert.equal(calls.length, 2, 'no timer left after close');
});

void test('future spam cannot silence a delayed unread arrival', () => {
  const { sent, observe } = notifier();
  observe(state(account('work', [{ ...row('spam', 'Spam'), date: '2099-01-01T00:00:00Z' }])));
  observe(
    state(
      account('work', [
        { ...row('spam', 'Spam'), date: '2099-01-01T00:00:00Z' },
        { ...row('delayed', 'Delayed'), date: '2026-11-01T00:00:00Z' },
      ]),
    ),
  );
  assert.equal(sent.length, 1);
  assert.match(sent[0]?.at(-1) ?? '', /Delayed/);
});

void test('fresh unread events are per account, baseline-free, and retain known IDs across failed polls', () => {
  const events: NewMailEvent[] = [];
  const sent: string[] = [];
  const run: Run = (bin) => {
    sent.push(bin);
    return Promise.resolve({ stdout: '', stderr: '', code: 0 });
  };
  const observe = createNewMailNotifier(run, { notify: false, onNewMail: (event) => events.push(event) });
  observe(state(account('work', [row('1', 'Old')]), account('personal', [])));
  assert.deepEqual(events, []);
  observe(
    state(
      account('work', [row('1', 'Old'), row('2', 'New'), row('3', 'New'), row('4', 'Read', true)]),
      account('personal', [row('2', 'Other')]),
    ),
  );
  assert.deepEqual(events, [
    { account: 'work', messageIds: ['2', '3'] },
    { account: 'personal', messageIds: ['2'] },
  ]);
  observe(state(account('work', [], 'failed')));
  observe(state(account('work', [row('1', 'Old'), row('2', 'New'), row('3', 'New')])));
  assert.equal(events.length, 2);
  assert.deepEqual(sent, []);
});

for (const notify of [false, true]) {
  void test(`mail capability isolates listeners and supports unsubscribe with notify=${notify}`, async (t) => {
    mock.timers.enable({ apis: ['setInterval'] });
    const db = openDb(':memory:');
    const capabilities = createCapabilityRegistry();
    const fakeRun = createFakeMailRun();
    const sent: string[] = [];
    const warnings: unknown[][] = [];
    const events: NewMailEvent[] = [];
    let id = '310';
    const run: Run = async (bin, args, options) => {
      if (bin === 'notify-send') sent.push(bin);
      const result = await fakeRun(bin, args, options);
      return { ...result, stdout: result.stdout.replaceAll('"310"', JSON.stringify(id)) };
    };
    const noop = () => undefined;
    const log = {
      level: 'info',
      fatal: noop,
      error: noop,
      warn: (...args: unknown[]) => warnings.push(args),
      info: noop,
      debug: noop,
      trace: noop,
      silent: noop,
      child: () => log,
    };
    const instance = mailModule.create({
      config: { accounts: [{ account: 'work', label: 'Work' }], archiveMailbox: 'archive', notify },
      run,
      fetch,
      log,
      zones: new Set(),
      focusHistory: createFocusHistory(db),
      capabilities,
    });
    t.after(async () => {
      await instance.close?.();
      db.$client.close();
    });
    const mail = capabilities.get('mail');
    assert.ok(mail);
    const stopThrowing = mail.onNewMail(() => {
      throw new Error('private payload must stay out of logs');
    });
    const stop = mail.onNewMail((event) => events.push(event));
    await flush();
    await flush();
    assert.deepEqual(events, []);
    id = 'new';
    mock.timers.tick(MAIL_POLL_MS);
    await flush();
    await flush();
    assert.deepEqual(events, [{ account: 'work', messageIds: ['new'] }]);
    assert.deepEqual(warnings, [['Mail listener failed']]);
    assert.equal(sent.length, notify ? 1 : 0);
    stop();
    stopThrowing();
    id = 'later';
    mock.timers.tick(MAIL_POLL_MS);
    await flush();
    await flush();
    assert.equal(events.length, 1);
    await instance.close?.();
    id = 'closed';
    mock.timers.tick(MAIL_POLL_MS);
    await flush();
    assert.equal(events.length, 1);
  });
}
