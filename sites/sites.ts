import { and, eq, lt } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { siteChecks, siteDays } from './schema.ts';

const interval = 5 * 60_000;
const pad = (value: number) => String(value).padStart(2, '0');
function localDay(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function daysEnding(at: number) {
  const today = new Date(at);
  return Array.from({ length: 90 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 89 + index, 12);
    return localDay(date.getTime());
  });
}

type Check = { at: number; status: number | null; latency: number; error: string | null };
type Site = { name: string; url: string };
export async function probe(fetcher: typeof fetch, url: string): Promise<Check> {
  const at = Date.now();
  try {
    const signal = AbortSignal.timeout(10_000);
    let response = await fetcher(url, { method: 'HEAD', signal });
    if (response.status === 405 || response.status === 501) response = await fetcher(url, { method: 'GET', signal });
    // Only the status matters; an unread body keeps the connection busy until garbage collection.
    await response.body?.cancel();
    return { at, status: response.status, latency: Date.now() - at, error: null };
  } catch (error) {
    return {
      at,
      status: null,
      latency: Date.now() - at,
      error: error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
    };
  }
}

export function recordCheck(db: Db, site: string, check: Check) {
  const day = localDay(check.at);
  const failed = check.status === null || check.status >= 400;
  db.transaction((tx) => {
    tx.insert(siteChecks)
      .values({ site, ...check })
      .run();
    const previous = tx
      .select()
      .from(siteDays)
      .where(and(eq(siteDays.site, site), eq(siteDays.day, day)))
      .get();
    const failures = (previous?.failed ?? 0) + Number(failed);
    const downMinutes = (previous?.downMinutes ?? 0) + (failed ? interval / 60_000 : 0);
    const worstStatus = downMinutes >= 30 ? 'major' : failures ? 'degraded' : 'operational';
    tx.insert(siteDays)
      .values({ site, day, checks: (previous?.checks ?? 0) + 1, failed: failures, downMinutes, worstStatus })
      .onConflictDoUpdate({
        target: [siteDays.site, siteDays.day],
        set: { checks: (previous?.checks ?? 0) + 1, failed: failures, downMinutes, worstStatus },
      })
      .run();
    tx.delete(siteChecks)
      .where(lt(siteChecks.at, check.at - 24 * 60 * 60_000))
      .run();
    tx.delete(siteDays)
      .where(lt(siteDays.day, daysEnding(check.at)[0] ?? day))
      .run();
  });
}

export function readSites(db: Db, sites: Site[], at = Date.now()) {
  const days = daysEnding(at);
  return sites.map((site) => {
    const checks = db.select().from(siteChecks).where(eq(siteChecks.site, site.url)).all();
    const latest = checks.toSorted((a, b) => b.at - a.at)[0];
    const recorded = db.select().from(siteDays).where(eq(siteDays.site, site.url)).all();
    const visible = recorded.filter((day) => day.day >= (days[0] ?? ''));
    const total = visible.reduce((sum, day) => sum + day.checks, 0);
    const failed = visible.reduce((sum, day) => sum + day.failed, 0);
    return {
      ...site,
      latest: latest ?? null,
      uptime: total ? ((total - failed) / total) * 100 : null,
      days: days.map((day) => {
        const row = visible.find((entry) => entry.day === day);
        const status: 'none' | 'major' | 'degraded' | 'operational' = !row
          ? 'none'
          : row.downMinutes >= 30
            ? 'major'
            : row.failed
              ? 'degraded'
              : 'operational';
        return { date: day, status, minutes: row?.downMinutes ?? 0 };
      }),
    };
  });
}
