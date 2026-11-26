import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { afterEach, mock, test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
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
