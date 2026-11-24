import { useQuery } from '@tanstack/react-query';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { calendarItemsOf } from './calendar-items.ts';
import type definition from './server.ts';

const client = createModuleClient<typeof definition>('lavoro');

export function useLavoroCalendarItems(range: { from: string; to: string }) {
  const answer = useQuery({
    queryKey: ['lavoro', 'calendar', range.from, range.to],
    queryFn: () => client.calendar.query(range),
  });
  return answer.data ? calendarItemsOf(answer.data) : undefined;
}
