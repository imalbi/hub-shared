import { useQuery } from '@tanstack/react-query';
import { localDay } from '../../apps/web/src/lib/day.ts';
import type { CalendarItem } from '../../apps/web/src/lib/module-ui.ts';
import { useNow } from '../../apps/web/src/lib/use-now.ts';
import { m } from './copy.ts';
import { studyCalendarItems } from './calendar-days.ts';
import { studySubjects, useStudyTRPC } from './use-study.ts';

/** Studio days for the Calendario page: done ones on their day, open ones sliding from today. */
export function useStudyCalendarItems(range: { from: string; to: string }): CalendarItem[] | undefined {
  const trpc = useStudyTRPC();
  const today = localDay(new Date(useNow('clock')));
  const index = useQuery(trpc.index.queryOptions()).data;
  const headers = useQuery(trpc.active.queryOptions()).data;
  if (index === undefined || headers === undefined) return undefined;
  if (index === null) return [];
  const subjects = studySubjects(headers);
  return studyCalendarItems(index, today, range, {
    open: m.calendar_kind_study(),
    done: m.calendar_study_done(),
    subject: (key) => subjects.find((subject) => subject.key === key)?.label,
  });
}
