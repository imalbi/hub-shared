import { effectiveApplicationStatus } from './applications.ts';
import type { ApplicationStatus } from './application-status.ts';
import type { BlacklistRule } from './blacklist.ts';
import type { Possibility } from './opinion-prompt.ts';
import { normalizeSearch } from './search.ts';
import type { JobRow } from './server.ts';
import { sortJobs } from './sort.ts';
import { tabOf } from './tabs.ts';

/** The palette keeps this many rows of a group (step 64); `total` counts every match. */
export const RECORD_ROWS = 3;

export type PostingHit = {
  key: string;
  title: string;
  company: string;
  location: string;
  /** The tab of Annunci the posting sits in. */
  segment: 'review' | 'archive' | 'blacklisted' | 'trash';
  score: number;
  possibility: Possibility | null;
};
export type ApplicationHit = {
  key: string;
  title: string;
  company: string;
  appliedAt: number;
  status: ApplicationStatus;
};

/** A row matches when every word of the query is in its title or company, without case or accents. */
function matcher(query: string) {
  const words = normalizeSearch(query).split(' ').filter(Boolean);
  return (row: JobRow) => {
    const text = normalizeSearch(`${row.title} ${row.company}`);
    return words.length > 0 && words.every((word) => text.includes(word));
  };
}

const SEGMENTS: PostingHit['segment'][] = ['review', 'archive', 'blacklisted', 'trash'];
function segmentOf(row: JobRow, rules: readonly BlacklistRule[]): PostingHit['segment'] {
  const segment = tabOf(row, undefined, rules);
  // `applications` is filtered out before this is read; `review` is the safe reading of anything else.
  return segment === 'applications' ? 'review' : segment;
}

/** Postings that have no application: those to review first, then archived, excluded, deleted; by opinion inside. */
export function searchPostings(rows: readonly JobRow[], rules: readonly BlacklistRule[], query: string) {
  const matching = rows.filter(matcher(query));
  // Annunci's order inside a tab, and the tab first: a deleted posting with a good opinion must not hide one to review.
  const found = sortJobs(
    matching.filter((row) => tabOf(row, undefined, rules) !== 'applications'),
    'opinion',
  ).toSorted((a, b) => SEGMENTS.indexOf(segmentOf(a, rules)) - SEGMENTS.indexOf(segmentOf(b, rules)));
  return {
    total: found.length,
    rows: found.slice(0, RECORD_ROWS).map((row): PostingHit => ({
      key: row.key,
      title: row.title,
      company: row.company,
      location: row.location,
      segment: segmentOf(row, rules),
      score: row.total,
      possibility: row.opinion?.possibility ?? null,
    })),
  };
}

/** Postings with an application, newest sent first. */
export function searchApplications(rows: readonly JobRow[], query: string, now: number) {
  const found = rows
    .filter(matcher(query))
    .flatMap((row) => (row.application ? [{ row, application: row.application }] : []))
    .toSorted((a, b) => b.application.appliedAt - a.application.appliedAt);
  return {
    total: found.length,
    rows: found.slice(0, RECORD_ROWS).map(({ row, application }): ApplicationHit => ({
      key: row.key,
      title: row.title,
      company: row.company,
      appliedAt: application.appliedAt,
      status: effectiveApplicationStatus(application, now),
    })),
  };
}
