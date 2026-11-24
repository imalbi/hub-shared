import type { CalendarItem } from '../../apps/web/src/lib/module-ui.ts';
import { localDay } from '../../apps/web/src/lib/day.ts';
import { copy } from './copy.ts';

type Answer = {
  interviews: { id: number; key: string; at: number; label: string }[];
  deadlines: { id: number; day: string; ask: string; sender: string }[];
};

const pad = (value: number) => String(value).padStart(2, '0');

/** Saved interviews (with their time) and open deadlines as items of the Calendario page. */
export function calendarItemsOf(answer: Answer): CalendarItem[] {
  return [
    ...answer.interviews.map((interview): CalendarItem => {
      const at = new Date(interview.at);
      return {
        id: `lavoro-interview-${interview.id}`,
        day: localDay(at),
        time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
        title: interview.label,
        kind: 'work',
        label: copy.calendar.interview,
        href: `/desk/ricerca?job=${encodeURIComponent(interview.key)}`,
      };
    }),
    ...answer.deadlines.map((due): CalendarItem => ({
      id: `lavoro-deadline-${due.id}`,
      day: due.day,
      title: due.ask,
      kind: 'work',
      label: copy.calendar.deadline,
      origin: copy.calendar.from(due.sender),
      href: '/desk',
    })),
  ];
}
