import { effectiveApplicationStatus, isActive, type ApplicationLike } from './applications.ts';
import type { ApplicationStatus } from './schema.ts';

export type CandidatureSegment = 'pending' | 'interview' | 'closed' | 'all';

type Row = { key: string; application: ApplicationLike | null };
type Options = { status?: ApplicationStatus | undefined; now: number };

export function selectApplications<T extends Row>(
  rows: readonly T[],
  options: Options & { segment: CandidatureSegment },
): T[] {
  return rows.filter((row) => {
    if (!row.application) return false;
    const effective = effectiveApplicationStatus(row.application, options.now);
    const hadInterview = !!row.application.interviews?.length || effective === 'interviewing' || effective === 'offer';
    if (options.status === 'interviewing' ? !hadInterview : options.status && effective !== options.status)
      return false;
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
  const count = (segment: CandidatureSegment) => selectApplications(rows, { now: options.now, segment }).length;
  return { pending: count('pending'), interview: count('interview'), closed: count('closed'), all: count('all') };
}
