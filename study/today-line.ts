import { useQuery } from '@tanstack/react-query';
import type { TodayDay, TodayLine } from '../../apps/web/src/lib/module-ui.ts';
import { m } from './copy.ts';
import { useStudyTRPC } from './use-study.ts';

/**
 * Oggi's Studio line (step 66): the current day "G3 · <title>" with "N di M passi", tomorrow the next day still to do
 * with "M passi". Nothing without an active plan. Reads the queries the Oggi tab already reads; no new one.
 */
export function useStudyTodayLines(day: TodayDay): TodayLine[] | null {
  const trpc = useStudyTRPC();
  const index = useQuery(trpc.index.queryOptions()).data;
  const progress = useQuery(trpc.progress.queryOptions()).data;
  const current = index?.days.find((item) => item.key === index.current);
  const target = day === 'today' ? current : index?.days.find((item) => !item.done && item.key !== index.current);
  const body = useQuery(trpc.daysById.queryOptions({ keys: target ? [target.key] : [] }, { enabled: !!target }))
    .data?.[0];
  if (!target || !body) return null;
  const steps = body.blocks.flatMap((block) => block.steps);
  const done = steps.filter((step) =>
    progress?.some(
      (row) => row.planId === body.planId && row.kind === 'step' && row.id === step.id && row.value === 'done',
    ),
  ).length;
  return [
    {
      id: `study-${target.key}`,
      chip: m.study_chip(),
      text: m.study_today_line({ g: target.g, title: target.title }),
      value:
        day === 'today'
          ? m.study_steps_done({ done, total: steps.length })
          : m.study_steps_total({ total: steps.length }),
      href: '/desk/studio',
    },
  ];
}

export function useStudyDaySummary() {
  return useStudyTodayLines('today')?.[0]?.value ?? null;
}
