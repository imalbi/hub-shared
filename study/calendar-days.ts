import type { CalendarItem } from '../../apps/web/src/lib/module-ui.ts';
import { addDays, localDay } from '../../apps/web/src/lib/day.ts';

type Day = { key: string; title: string; subject: string; done: boolean; doneAt: string | null };
type Copy = { open: string; done: string; subject: (key: string) => string | undefined };

/**
 * Study days on the calendar (owner, 2026-11-15): a done day stays on the day it was done; open days have no date,
 * so they slide one a day from today (from tomorrow once a day is done today), the current one first, in plan order.
 */
export function studyCalendarItems(
  index: { current: string | null; days: readonly Day[]; hiddenDays: readonly Day[] },
  today: string,
  range: { from: string; to: string },
  copy: Copy,
): CalendarItem[] {
  const item = (day: Day, on: string, label: string): CalendarItem => {
    const origin = copy.subject(day.subject);
    return {
      id: `study-${day.key}`,
      day: on,
      title: day.title,
      kind: 'study',
      label,
      ...(origin ? { origin } : {}),
      href: '/desk/studio',
    };
  };
  const done = [...index.days, ...index.hiddenDays].flatMap((day) =>
    day.done && day.doneAt ? [{ day, on: localDay(new Date(day.doneAt)) }] : [],
  );
  const open = index.days.filter((day) => !day.done);
  const current = open.find((day) => day.key === index.current);
  const queue = current ? [current, ...open.filter((day) => day !== current)] : open;
  const start = done.some(({ on }) => on === today) ? addDays(today, 1) : today;
  return [
    ...done.filter(({ on }) => on >= range.from && on <= range.to).map(({ day, on }) => item(day, on, copy.done)),
    ...queue
      .map((day, index_) => ({ day, on: addDays(start, index_) }))
      .filter(({ on }) => on >= range.from && on <= range.to)
      .map(({ day, on }) => item(day, on, copy.open)),
  ];
}
