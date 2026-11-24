import { effectiveApplicationStatus, isActive } from './applications.ts';
import { segmentCounts } from './candidature-view.ts';
import { possibilityOf, type Possibility, type StoredOpinion } from './opinion-prompt.ts';
import type { JobRow, RuleRow } from './server.ts';
import { sortJobs } from './sort.ts';
import { tabOf } from './tabs.ts';
import { countInterviews } from './today.ts';

const DAY_MS = 86_400_000;
const TOP_LIMIT = 4;
const GROUP_SPLIT_LIMIT = 2;

export type LavoroSummaryItem = {
  key: string;
  title: string;
  company: string;
  location: string;
  score: number;
  possibility: Possibility;
  codes: StoredOpinion['codes'];
  outdated: boolean;
};

export type LavoroSummary = {
  review: number;
  reviewToday: number;
  byPossibility: Record<Possibility, number>;
  pending: number;
  interviewing: number;
  interviewsThisWeek: number;
  lastCollectionAt: number | null;
  top: LavoroSummaryItem[];
};

/** Builds the lightweight Panoramica summary and active Oggi interview count without cloning full job descriptions. */
export function summarizeLavoro(
  jobs: readonly JobRow[],
  rules: readonly RuleRow[],
  now: number,
  lastCollectionAt: number | null,
): LavoroSummary {
  const reviewJobs = jobs
    .filter((job) => tabOf(job, undefined, rules) === 'review')
    .map((job) =>
      job.opinion ? { ...job, opinion: { ...job.opinion, possibility: possibilityOf(job.opinion) } } : job,
    );

  const byPossibility: Record<Possibility, number> = { alta: 0, media: 0, bassa: 0, fuori: 0 };
  let reviewToday = 0;
  for (const job of reviewJobs) {
    if (job.firstSeen >= now - DAY_MS && job.firstSeen <= now) reviewToday += 1;
    if (job.opinion) byPossibility[job.opinion.possibility] += 1;
  }

  const sorted = sortJobs(reviewJobs, 'opinion');
  const altaSorted: LavoroSummaryItem[] = [];
  const mediaSorted: LavoroSummaryItem[] = [];
  for (const job of sorted) {
    if (!job.opinion) continue;
    if (job.opinion.possibility !== 'alta' && job.opinion.possibility !== 'media') continue;
    const item: LavoroSummaryItem = {
      key: job.key,
      title: job.title,
      company: job.company,
      location: job.location,
      score: job.total,
      possibility: job.opinion.possibility,
      codes: job.opinion.codes,
      outdated: job.opinion.outdated,
    };
    if (item.possibility === 'alta') altaSorted.push(item);
    else mediaSorted.push(item);
  }
  const altaLimit = mediaSorted.length > 0 ? GROUP_SPLIT_LIMIT : TOP_LIMIT;
  const mediaLimit = altaSorted.length > 0 ? GROUP_SPLIT_LIMIT : TOP_LIMIT;
  const top = [...altaSorted.slice(0, altaLimit), ...mediaSorted.slice(0, mediaLimit)].slice(0, TOP_LIMIT);

  const counts = segmentCounts(jobs, { now });
  const activeInterviewDates = jobs.flatMap((job) => {
    if (!job.application) return [];
    if (!isActive(effectiveApplicationStatus(job.application, now))) return [];
    return job.application.interviews?.map((interview) => interview.scheduledAt) ?? [];
  });

  return {
    review: reviewJobs.length,
    reviewToday,
    byPossibility,
    pending: counts.pending,
    interviewing: counts.interview,
    interviewsThisWeek: countInterviews(activeInterviewDates, now),
    lastCollectionAt,
    top,
  };
}
