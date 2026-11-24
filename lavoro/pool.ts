import type { Profile } from './config.ts';
import type { Clock } from './source.ts';

/**
 * Runs the searches with one pool per site: `workersBySite[site] ?? workersPerSite` at a time, starts on the same
 * site at least `pauseSeconds` apart, sites independent of each other. `onWait` reports the longest pause still
 * running on a site, in seconds, and null when none is. A cancelled collection starts nothing new.
 */
export async function runPools<T extends { site: string }>(
  searches: readonly T[],
  search: Pick<Profile['search'], 'workersPerSite' | 'workersBySite' | 'pauseSeconds'>,
  clock: Clock,
  signal: AbortSignal,
  run: (item: T) => Promise<void>,
  onWait: (site: string, seconds: number | null) => void,
) {
  const bySite = new Map<string, T[]>();
  for (const item of searches) bySite.set(item.site, [...(bySite.get(item.site) ?? []), item]);
  const overrides: Record<string, number | undefined> = search.workersBySite;
  const pauseMs = search.pauseSeconds * 1000;

  async function runSite(site: string, queue: T[]) {
    let next = 0;
    let lastStart = -Infinity;
    // Workers can wait at the same time: report the longest remaining wait, and null only when none is left.
    const ends = new Set<number>();
    const report = () => onWait(site, ends.size ? Math.ceil((Math.max(...ends) - clock.now()) / 1000) : null);
    async function worker() {
      while (!signal.aborted) {
        const item = queue[next++];
        if (!item) return;
        // The slot is reserved before waiting, in one synchronous step, so two workers never share a start time.
        const startAt = Math.max(clock.now(), lastStart + pauseMs);
        lastStart = startAt;
        const wait = startAt - clock.now();
        if (wait > 0) {
          ends.add(startAt);
          report();
          await clock.sleep(wait, signal);
          ends.delete(startAt);
          report();
          if (signal.aborted) return;
        }
        await run(item);
      }
    }
    const workers = Math.min(overrides[site] ?? search.workersPerSite, queue.length);
    await Promise.all(Array.from({ length: workers }, worker));
  }

  await Promise.all([...bySite].map(([site, queue]) => runSite(site, queue)));
}
