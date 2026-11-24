import type { JobRow } from './server.ts';

export type SortOption = 'opinion' | 'score' | 'newest' | 'company' | 'title';

const possibilityRank = { alta: 0, media: 1, bassa: 3, fuori: 4 } as const;

/** Alta, media, no opinion yet, bassa, fuori. */
function opinionRank(job: JobRow): number {
  return job.opinion ? possibilityRank[job.opinion.possibility] : 2;
}

export type PostingGroupId = 'alta' | 'media' | 'senza' | 'bassa' | 'fuori';
export type PostingGroup = { id: PostingGroupId; jobs: JobRow[] };

/** Splits rows already sorted by 'opinion' into the groups the list shows; empty groups are left out. */
export function groupJobs(sorted: readonly JobRow[]): PostingGroup[] {
  const groupOf = (job: JobRow): PostingGroupId => {
    if (!job.opinion) return 'senza';
    return job.opinion.possibility;
  };
  const ids: PostingGroupId[] = ['alta', 'media', 'senza', 'bassa', 'fuori'];
  return ids
    .map((id) => ({ id, jobs: sorted.filter((job) => groupOf(job) === id) }))
    .filter((group) => group.jobs.length > 0);
}

/**
 * Sorts job postings stably according to SortOption.
 * Ties are always broken by firstSeen descending.
 */
export function sortJobs(jobs: readonly JobRow[], option: SortOption = 'score'): JobRow[] {
  const tie = (a: JobRow, b: JobRow) => b.firstSeen - a.firstSeen;

  return jobs.toSorted((a, b) => {
    if (option === 'opinion') {
      const rank = opinionRank(a) - opinionRank(b);
      if (rank !== 0) return rank;
      const diff = b.total - a.total;
      return diff !== 0 ? diff : tie(a, b);
    }

    if (option === 'score') {
      const diff = b.total - a.total;
      return diff !== 0 ? diff : tie(a, b);
    }

    if (option === 'newest') {
      const aTime = a.postedAt ?? a.firstSeen;
      const bTime = b.postedAt ?? b.firstSeen;
      const diff = bTime - aTime;
      return diff !== 0 ? diff : tie(a, b);
    }

    if (option === 'company') {
      const diff = a.company.localeCompare(b.company, 'it', { sensitivity: 'base' });
      return diff !== 0 ? diff : tie(a, b);
    }

    if (option === 'title') {
      const diff = a.title.localeCompare(b.title, 'it', { sensitivity: 'base' });
      return diff !== 0 ? diff : tie(a, b);
    }

    return tie(a, b);
  });
}
