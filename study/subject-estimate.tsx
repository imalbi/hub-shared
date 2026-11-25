import { m } from './copy.ts';

export function SubjectEstimate({
  id,
  index,
}: {
  id: string;
  index: {
    mix: Record<string, number> | null;
    weeklyHours: number | null;
    days: { subject: string; done: boolean; minutes?: number }[];
    hiddenDays: { subject: string; done: boolean; minutes?: number }[];
  };
}) {
  const share = index.mix?.[id];
  if (share === undefined || index.weeklyHours === null) return null;
  const hours = (index.weeklyHours * share) / 100;
  const remaining = [...index.days, ...index.hiddenDays].filter((day) => day.subject === id && !day.done);
  const minutes = remaining.every((day) => day.minutes !== undefined)
    ? remaining.reduce((sum, day) => sum + (day.minutes ?? 0), 0)
    : null;
  const format = (value: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
  return (
    <span className="block text-caption text-muted-foreground">
      {m.study_weekly_share({ share: format(share), hours: format(hours) })}
      {minutes !== null &&
        hours > 0 &&
        ` · ${m.study_remaining({ hours: format(minutes / 60), weeks: format(minutes / 60 / hours) })}`}
    </span>
  );
}
