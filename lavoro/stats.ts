import { effectiveApplicationStatus } from './applications.ts';
import type { ApplicationLike } from './applications.ts';

export type StatsRow = {
  key: string;
  site: string;
  application: ApplicationLike | null;
  opinion: { possibility: string } | null;
};

export type Outcomes = {
  sent: number;
  replied: number;
  interviews: number;
  offers: number;
  rejections: number;
  ghosted: number;
  ghostedAfterInterview: number;
};

/** A reply requires an interview, offer or rejection; ghosting includes every effective expiry. */
export function outcomesOf(rows: readonly StatsRow[], now: number): Outcomes {
  const result: Outcomes = {
    sent: 0,
    replied: 0,
    interviews: 0,
    offers: 0,
    rejections: 0,
    ghosted: 0,
    ghostedAfterInterview: 0,
  };
  for (const { application } of rows) {
    if (!application) continue;
    const status = effectiveApplicationStatus(application, now);
    const interviewed = status === 'interviewing' || status === 'offer' || (application.interviews?.length ?? 0) > 0;
    result.sent += 1;
    if (interviewed || status === 'rejected') result.replied += 1;
    if (interviewed) result.interviews += 1;
    if (status === 'offer') result.offers += 1;
    if (status === 'rejected') result.rejections += 1;
    if (status === 'expired') {
      result.ghosted += 1;
      if (application.interviews?.length) result.ghostedAfterInterview += 1;
    }
  }
  return result;
}

/** The display name for a source or opinion id; an id the map does not know shows as it is. */
export const displayName = (names: Record<string, string>, id: string) => names[id] ?? id;

const possibilityOrder: readonly string[] = ['alta', 'media', 'bassa', 'fuori'];

export function applicationStats(rows: readonly StatsRow[], now: number) {
  const sources = [...new Set(rows.filter((row) => row.application).map((row) => row.site))].toSorted();
  const seen = new Set(rows.flatMap((row) => (row.opinion ? [row.opinion.possibility] : [])));
  const possibilities = [
    ...possibilityOrder.filter((id) => seen.has(id)),
    ...[...seen].filter((id) => !possibilityOrder.includes(id)).toSorted(),
  ];
  return {
    total: outcomesOf(rows, now),
    bySource: sources.map((site) => ({
      site,
      ...outcomesOf(
        rows.filter((row) => row.site === site),
        now,
      ),
    })),
    // Judged counts every posting with a verdict; the outcomes cover only the ones applied to.
    byVerdict: possibilities.map((possibility) => {
      const judged = rows.filter((row) => row.opinion?.possibility === possibility);
      return { possibility, judged: judged.length, ...outcomesOf(judged, now) };
    }),
  };
}

const DAY = 86_400_000;

/**
 * Median days from applying to the first answer (an invitation or a rejection; an automatic "received" is not one),
 * with how many applications it rests on. Null when none has an answer. An answer dated before the application is a
 * wrong link and is ignored. Total only, not per source (owner, step 54).
 */
export function firstResponse(
  applications: readonly { key: string; appliedAt: number }[],
  answers: readonly { key: string; at: number }[],
) {
  const days = applications
    .flatMap(({ key, appliedAt }) => {
      const times = answers.filter((answer) => answer.key === key && answer.at >= appliedAt).map((answer) => answer.at);
      return times.length > 0 ? [(Math.min(...times) - appliedAt) / DAY] : [];
    })
    .toSorted((a, b) => a - b);
  if (days.length === 0) return null;
  const middle = days.length >> 1;
  const median = days.length % 2 ? (days[middle] ?? 0) : ((days[middle - 1] ?? 0) + (days[middle] ?? 0)) / 2;
  return { medianDays: median, count: days.length };
}
