import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeClock } from './fake-clock.ts';
import { runPools } from './pool.ts';

type Item = { site: string; id: number };
const items = (site: string, count: number): Item[] => Array.from({ length: count }, (_, id) => ({ site, id }));
const settings = (patch: { workersPerSite?: number; workersBySite?: { indeed?: number }; pauseSeconds?: number }) => ({
  workersPerSite: 1,
  workersBySite: {},
  pauseSeconds: 0,
  ...patch,
});

void test('a site runs at most its own number of searches at once, and sites do not wait for each other', async () => {
  const { clock, drain } = createFakeClock();
  const begin = clock.now();
  const active = new Map<string, number>();
  const peak = new Map<string, number>();
  await Promise.all([
    runPools(
      [...items('indeed', 4), ...items('linkedin', 3)],
      settings({ workersBySite: { indeed: 2 } }),
      clock,
      new AbortController().signal,
      async ({ site }) => {
        active.set(site, (active.get(site) ?? 0) + 1);
        peak.set(site, Math.max(peak.get(site) ?? 0, active.get(site) ?? 0));
        await clock.sleep(100);
        active.set(site, (active.get(site) ?? 0) - 1);
      },
      () => undefined,
    ),
    drain(),
  ]);
  assert.deepEqual([peak.get('indeed'), peak.get('linkedin')], [2, 1]);
  // linkedin: 3 searches one after another; indeed: 4 searches two at a time, which is shorter
  assert.equal(clock.now() - begin, 300);
});

void test('starts on the same site are at least pauseSeconds apart, whatever the number of workers', async () => {
  const { clock, drain } = createFakeClock();
  const begin = clock.now();
  const starts = new Map<string, number[]>();
  const waits: Array<[string, number | null]> = [];
  await Promise.all([
    runPools(
      [...items('indeed', 3), ...items('linkedin', 1)],
      settings({ workersPerSite: 2, pauseSeconds: 3 }),
      clock,
      new AbortController().signal,
      async ({ site }) => {
        starts.set(site, [...(starts.get(site) ?? []), clock.now() - begin]);
        await clock.sleep(10);
      },
      (site, seconds) => waits.push([site, seconds]),
    ),
    drain(),
  ]);
  // another site has its own rhythm: linkedin starts at once, not behind indeed's pause
  assert.deepEqual(starts.get('indeed'), [0, 3000, 6000]);
  assert.deepEqual(starts.get('linkedin'), [0]);
  // two workers wait at once: the report is the longest wait left, and it clears only when the last one ends
  assert.deepEqual(waits, [
    ['indeed', 3],
    ['indeed', 6],
    ['indeed', 3],
    ['indeed', null],
  ]);
});

void test('cancelling during a pause ends it at once and starts nothing else', async () => {
  const { clock, advance } = createFakeClock();
  const controller = new AbortController();
  const started: number[] = [];
  const pools = runPools(
    items('indeed', 3),
    settings({ pauseSeconds: 30 }),
    clock,
    controller.signal,
    async ({ id }) => {
      started.push(id);
    },
    () => undefined,
  );
  await advance(1000);
  assert.deepEqual(started, [0]);
  controller.abort();
  await pools;
  assert.deepEqual(started, [0]);
});
