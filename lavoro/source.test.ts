import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultClock } from './source.ts';

void test('the real clock sleeps on a timer and wakes early when the signal aborts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const woke: string[] = [];
  const timer = defaultClock.sleep(1000).then(() => woke.push('timer'));
  const controller = new AbortController();
  const aborted = defaultClock.sleep(60_000, controller.signal).then(() => woke.push('abort'));
  controller.abort();
  await aborted;
  t.mock.timers.tick(1000);
  await timer;
  assert.deepEqual(woke, ['abort', 'timer']);
  // already aborted: no timer is even started
  await defaultClock.sleep(60_000, controller.signal);
});
