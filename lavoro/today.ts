import { copy } from './copy.ts';

export function todayParts(review: number, interviews: number) {
  return [
    ...(review ? [{ text: copy.today.review(review), href: '/desk/ricerca?segment=review' }] : []),
    ...(interviews ? [{ text: copy.today.interviews(interviews), href: '/desk/ricerca?tab=candidature' }] : []),
  ];
}

export function countInterviews(dates: readonly number[], now: number) {
  return dates.filter((date) => date >= now && date <= now + 7 * 86_400_000).length;
}
