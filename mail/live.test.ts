import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import type { Run } from '../../apps/server/src/core/exec.ts';
import { createFakeMailRun } from './fake-himalaya.ts';
import { createMailLive, MAIL_POLL_MS } from './live.ts';

afterEach(() => mock.timers.reset());

void test('mail is read only while someone watches, once a minute, and not after the last one leaves', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  const calls: string[][] = [];
  const run: Run = createFakeMailRun({ calls });
  const live = createMailLive(run, [{ label: 'Lavoro', account: 'work' }]);

  await flush();
  assert.equal(calls.length, 0, 'nobody subscribed, nobody reads');

  const abort = new AbortController();
  const sub = live.subscribe(abort.signal);
  const first = await sub.next();
  assert.equal(first.value?.accounts[0]?.unread, 2);
  assert.equal(calls.length, 1, 'the first state is read once on subscribe');

  mock.timers.tick(MAIL_POLL_MS - 1);
  await flush();
  assert.equal(calls.length, 1);
  mock.timers.tick(1);
  await flush();
  await flush();
  assert.equal(calls.length, 2, 'the next read comes one minute later');

  // The subscriber resumes once after its signal aborts, as the tRPC loop does; that is when the poll is released.
  abort.abort();
  await sub.next().catch(() => undefined);
  mock.timers.tick(MAIL_POLL_MS * 3);
  await flush();
  assert.equal(calls.length, 2, 'a watcher that left stops the poll');
});

void test('the account state reports its unread count and the latest rows without a body', async () => {
  const run: Run = createFakeMailRun();
  const live = createMailLive(run, [
    { label: 'Lavoro', account: 'work' },
    { label: 'Personale', account: 'personal' },
  ]);
  const abort = new AbortController();
  const sub = live.subscribe(abort.signal);
  const state = (await sub.next()).value;
  abort.abort();
  await sub.next().catch(() => undefined);
  assert.deepEqual(
    state?.accounts.map((account) => [account.label, account.unread, account.capped, account.failure]),
    [
      ['Lavoro', 2, false, null],
      ['Personale', 1, false, null],
    ],
  );
  assert.equal(state?.accounts[0]?.latest.length, 3);
  assert.equal(state?.accounts[0]?.latest[0]?.subject, 'Offerta di colloquio');
});
