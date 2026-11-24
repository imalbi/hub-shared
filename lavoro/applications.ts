import type { ApplicationStatus } from './schema.ts';

export const activeStatuses: readonly string[] = ['pending', 'interviewing', 'offer'];
export const isActive = (status: string) => activeStatuses.includes(status);

export const EXPIRY_DAYS = 21;
export const EXPIRY_MS = EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export type ApplicationLike = {
  status: ApplicationStatus;
  appliedAt: number;
  interviews?: readonly { scheduledAt: number | Date }[] | null;
};

/**
 * Counts as expired in the UI, without changing the saved status: a pending application with no interviews 21 days
 * after it was sent, or a pending or interviewing one 21 days after its latest interview (ghosting after an interview).
 */
export function isApplicationExpired(app: ApplicationLike, now: number = Date.now()): boolean {
  if (app.interviews?.length) {
    if (app.status !== 'pending' && app.status !== 'interviewing') return false;
    return now - Math.max(...app.interviews.map((interview) => Number(interview.scheduledAt))) > EXPIRY_MS;
  }
  return app.status === 'pending' && now - app.appliedAt > EXPIRY_MS;
}

/**
 * Computes the effective application status:
 * returns 'expired' if the 21-day rule applies, or the saved status otherwise.
 */
export function effectiveApplicationStatus(app: ApplicationLike, now: number = Date.now()): ApplicationStatus {
  if (isApplicationExpired(app, now)) return 'expired';
  return app.status;
}
