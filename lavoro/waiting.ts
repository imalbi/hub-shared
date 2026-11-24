import { EXPIRY_MS, isApplicationExpired, type ApplicationLike } from './applications.ts';

const DAY_MS = 86_400_000;
/** The closing line shows only inside the last week of the 21-day rule. */
export const CLOSING_SOON_DAYS = 7;

/** Whole days since the application was sent (0 on the day, never negative). */
export function daysSince(appliedAt: number, now: number) {
  return Math.max(0, Math.floor((now - appliedAt) / DAY_MS));
}

/**
 * Days left before the 21-day rule marks a pending application without interviews as expired, when that is within
 * a week; otherwise null. It mirrors `isApplicationExpired` (strictly more than 21 days), so the last day reads 1.
 */
export function closesInDays(app: ApplicationLike, now: number) {
  if (app.status !== 'pending' || (app.interviews && app.interviews.length > 0) || isApplicationExpired(app, now))
    return null;
  const left = Math.max(1, Math.ceil((app.appliedAt + EXPIRY_MS - now) / DAY_MS));
  return left <= CLOSING_SOON_DAYS ? left : null;
}
