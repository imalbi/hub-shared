import { setImmediate } from 'node:timers/promises';
import type { Clock } from './source.ts';

/** Lets every promise chain that can run, run: the fake source and the engine only ever wait on this clock. */
export async function settle() {
  for (let round = 0; round < 8; round++) await setImmediate();
}

/**
 * A clock that moves only when a test says so: `sleep` parks until `advance` reaches it, so pauses, delays and
 * windows are driven in virtual time and no test waits for real.
 */
export function createFakeClock(start = Date.UTC(2026, 10, 5, 8, 0, 0)) {
  let current = start;
  const timers: Array<{ at: number; wake: () => void }> = [];

  const clock: Clock = {
    now: () => current,
    sleep: (ms, signal) =>
      new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = { at: current + ms, wake: resolve };
        timers.push(timer);
        signal?.addEventListener(
          'abort',
          () => {
            timers.splice(timers.indexOf(timer), 1);
            resolve();
          },
          { once: true },
        );
      }),
  };

  /** Moves time forward, waking the timers that fall due in order and letting what they start run in between. */
  async function advance(ms: number) {
    const target = current + ms;
    for (;;) {
      await settle();
      const due = timers.filter((timer) => timer.at <= target).toSorted((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      current = Math.max(current, due.at);
      due.wake();
    }
    current = target;
    await settle();
  }

  /** Runs until nothing is left to wait for; fails loudly instead of looping if a test never settles. */
  async function drain(limit = 10_000) {
    for (let step = 0; step < limit; step++) {
      await settle();
      const next = timers.toSorted((a, b) => a.at - b.at)[0];
      if (!next) return;
      await advance(Math.max(0, next.at - current));
    }
    throw new Error('fake clock: timers keep arriving');
  }

  return { clock, advance, drain, pending: () => timers.length };
}
