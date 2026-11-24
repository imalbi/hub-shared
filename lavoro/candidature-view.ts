import { effectiveApplicationStatus, isActive, type ApplicationLike } from './applications.ts';
import type { ApplicationStatus } from './schema.ts';

export type CandidatureSegment = 'pending' | 'interview' | 'closed' | 'all';

type Row = { key: string; application: ApplicationLike | null };
type Options = { status?: ApplicationStatus | undefined; now: number };

/**
 * One selector for the list and for the segment counts, so a count is always the length of the list it opens.
 * `status` narrows any segment to one
 * effective status (the 21-day rule included).
 */
export function selectApplications<T extends Row>(
  rows: readonly T[],
  options: Options & { segment: CandidatureSegment },
): T[] {
  return rows.filter((row) => {
    if (!row.application) return false;
    const effective = effectiveApplicationStatus(row.application, options.now);
    if (options.status && effective !== options.status) return false;
    switch (options.segment) {
      case 'pending':
        return effective === 'pending' && !row.application.interviews?.length;
      case 'interview':
        return (
          effective === 'interviewing' ||
          effective === 'offer' ||
          (effective === 'pending' && !!row.application.interviews?.length)
        );
      case 'closed':
        return !isActive(effective);
      case 'all':
        return true;
    }
  });
}

export function segmentCounts(rows: readonly Row[], options: Options): Record<CandidatureSegment, number> {
  const count = (segment: CandidatureSegment) => selectApplications(rows, { ...options, segment }).length;
  return { pending: count('pending'), interview: count('interview'), closed: count('closed'), all: count('all') };
}
