import type { TodayDay, TodayLine } from '../../apps/web/src/lib/module-ui.ts';
import { copy } from './copy.ts';
import { summarizeMail } from './summary.ts';
import { useMail } from './use-mail.ts';

/** Oggi's Posta line: the unread count the Posta widget shows, nothing at zero. Today only. */
export function useMailTodayLines(day: TodayDay): TodayLine[] | null {
  const accounts = useMail().data?.accounts;
  const summary = accounts && summarizeMail(accounts);
  if (day !== 'today' || !summary?.count) return null;
  return [
    {
      id: 'mail-unread',
      chip: copy.chip,
      text: summary.capped ? copy.countCapped(summary.count) : copy.count(summary.count),
      href: '/desk/messaggi',
    },
  ];
}
