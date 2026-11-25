import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Ticks } from '../../apps/web/src/components/ticks.tsx';
import { Checkbox } from '../../apps/web/src/components/ui/checkbox.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { useTRPC } from '../../apps/web/src/lib/trpc.ts';
import type { WidgetSize } from '../../apps/web/src/lib/widget-size.ts';
import { m } from './copy.ts';
import { usePomodoro } from '../../apps/web/src/modules/pomodoro/use-pomodoro.ts';
import { StepFile } from './day-body.tsx';
import { MaterialAction } from './material.tsx';
import {
  useCurrentStudyDay,
  useStudySteps,
  type StudyDay,
  type StudyDayBody,
  type StudyProgressRow,
} from './use-study.ts';

const MAX_LARGE_STEPS = 6;

const primaryLinkClass =
  'inline-flex min-h-touch items-center rounded-full bg-primary px-md text-label whitespace-nowrap text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

const secondaryLinkClass =
  'inline-flex min-h-touch shrink-0 items-center rounded-full border border-border px-md text-label whitespace-nowrap hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

/** Studio widget on Panoramica in piccolo (3x1), medio (6x1), and grande (6x2). */
export function StudyWidget({ size }: { size: WidgetSize }) {
  const study = useCurrentStudyDay();
  if (study.isError)
    return (
      <Panel title={m.zone_study()} className="h-full">
        <p className="text-caption text-muted-foreground">{m.study_error()}</p>
      </Panel>
    );
  if (study.isPending)
    return (
      <Panel title={m.zone_study()} className="h-full">
        <LoadingSkeleton label={m.tile_loading()} rows={size === 'large' ? 4 : 2} />
      </Panel>
    );
  if (!study.index || !study.day || !study.header || !study.current)
    return (
      <Panel title={m.zone_study()} className="h-full">
        <div className="mt-auto flex flex-wrap items-end justify-between gap-sm">
          <p className="text-body text-muted-foreground">{m.study_no_plan()}</p>
          <Link to="/desk/studio" className={secondaryLinkClass}>
            {m.zone_open({ zone: m.zone_study() })}
          </Link>
        </div>
      </Panel>
    );
  return (
    <StudyWidgetBody
      size={size}
      day={study.day}
      current={study.current}
      records={study.records ?? []}
      subjectLabel={study.subjectInfo?.label}
    />
  );
}

function StudyWidgetBody({
  size,
  day,
  current,
  records,
  subjectLabel,
}: {
  size: WidgetSize;
  day: StudyDayBody;
  current: StudyDay;
  records: StudyProgressRow[];
  subjectLabel?: string;
}) {
  const trpc = useTRPC();
  const enabled = useQuery(trpc.modules.enabled.queryOptions()).data;
  const pomodoroOn = !enabled || enabled.includes('pomodoro');
  const { allSteps, checked, failed, saveStep } = useStudySteps(day, records);
  const doneCount = checked.size;
  const stateLine =
    current.g !== null && subjectLabel
      ? m.study_widget_state({ g: current.g, subject: subjectLabel })
      : (subjectLabel ?? (current.g !== null ? `G${current.g}` : ''));
  const stepCount = m.study_step_count({ done: doneCount, total: allSteps.length });
  const headerState = stateLine ? <span className="text-muted-foreground">{stateLine}</span> : undefined;

  if (size === 'small')
    return (
      <Panel title={m.zone_study()} className="relative h-full" action={headerState}>
        <Link
          to="/desk/studio"
          aria-label={m.zone_open({ zone: m.zone_study() })}
          className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-accent"
        />
        <div className="mt-auto flex min-w-0 flex-col gap-xs">
          <p className="truncate text-body">{day.title}</p>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-xs">
            <Ticks value={doneCount} total={allSteps.length} />
            <p className="text-label text-muted-foreground tabular-nums">{stepCount}</p>
          </div>
        </div>
      </Panel>
    );

  if (size === 'medium') {
    const nextStep = allSteps.find((step) => !checked.has(step.id));
    return (
      <Panel title={m.zone_study()} className="h-full" action={headerState}>
        <div className="flex min-h-0 flex-1 flex-col justify-between gap-xs">
          <p className="truncate text-heading">{day.title}</p>
          <div className="flex min-w-0 items-end justify-between gap-md">
            <div className="flex min-w-0 flex-1 flex-col gap-2xs">
              {nextStep ? (
                <>
                  <p className="text-caps text-muted-foreground">{m.study_next_step()}</p>
                  <div className="flex min-w-0 items-center gap-sm">
                    <Checkbox
                      aria-label={nextStep.text}
                      checked={checked.has(nextStep.id)}
                      onCheckedChange={(done) => saveStep(nextStep.id, done)}
                    />
                    <span className="min-w-0 flex-1 truncate text-body">{nextStep.text}</span>
                  </div>
                </>
              ) : (
                <p className="text-body text-muted-foreground">{m.study_all_steps_done()}</p>
              )}
              <Ticks value={doneCount} total={allSteps.length} />
            </div>
            <div className="flex shrink-0 items-center gap-xs">
              {nextStep?.file && (
                <MaterialAction path={nextStep.file.path} page={nextStep.file.page} label={m.study_open_pdf()} />
              )}
              <Link to="/desk/studio" className={primaryLinkClass}>
                {m.zone_open({ zone: m.zone_study() })}
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  const visibleSteps = allSteps.slice(0, MAX_LARGE_STEPS);
  const remaining = allSteps.length - visibleSteps.length;
  const largeState = stateLine ? `${stateLine} · ${stepCount}` : stepCount;
  const failedEntries = Object.entries(failed);
  return (
    <Panel
      title={m.zone_study()}
      className="h-full"
      action={<span className="text-muted-foreground">{largeState}</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-xs">
        <div className="flex min-w-0 items-center justify-between gap-md">
          <p className="min-w-0 flex-1 truncate text-heading">{day.title}</p>
          <Ticks value={doneCount} total={allSteps.length} />
        </div>
        <ul className="flex min-w-0 flex-col">
          {visibleSteps.map((step) => {
            const done = checked.has(step.id);
            return (
              <li
                key={step.id}
                className="flex min-h-touch min-w-0 items-center gap-sm border-b border-dashed border-border py-3xs text-body last:border-b-0"
              >
                <Checkbox aria-label={step.text} checked={done} onCheckedChange={(value) => saveStep(step.id, value)} />
                <span className={`min-w-0 flex-1 truncate ${done ? 'text-muted-foreground' : ''}`}>{step.text}</span>
                {step.file && <StepFile file={step.file} />}
              </li>
            );
          })}
        </ul>
        <div className="mt-auto flex min-w-0 items-center justify-between gap-sm">
          {failedEntries.length > 0 ? (
            <div role="alert" className="min-w-0 truncate text-caption text-danger">
              {m.study_save_failed()}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  const first = failedEntries[0];
                  if (first) saveStep(first[0], first[1]);
                }}
              >
                {m.study_retry()}
              </button>
            </div>
          ) : remaining > 0 ? (
            <span className="truncate text-label text-muted-foreground tabular-nums">
              {m.study_more_steps({ count: remaining })}
            </span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-xs">
            {pomodoroOn && <StudyPomodoroButton tag={`study/${day.key}`} />}
            <Link to="/desk/studio" className={primaryLinkClass}>
              {m.zone_open({ zone: m.zone_study() })}
            </Link>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function StudyPomodoroButton({ tag }: { tag: string }) {
  const timer = usePomodoro(tag);
  return (
    <RegistryButton
      secondary
      label={timer.primaryAction === 'start' ? m.study_start_pomodoro() : timer.primaryLabel}
      action={() => timer.act(timer.primaryAction)}
      disabled={timer.pending || timer.state === undefined || timer.connectionLost}
    />
  );
}
