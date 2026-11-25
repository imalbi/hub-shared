import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { m } from './copy.ts';
import { studySubjects, subjectShade, useStudyTRPC, type StudyDay, type StudySubject } from './use-study.ts';
import { PlanGroup } from './plan-group.tsx';

const WEEK = 7;

export function StudyPlan() {
  const trpc = useStudyTRPC();
  const active = useQuery(trpc.active.queryOptions());
  const index = useQuery(trpc.index.queryOptions());
  const [subject, setSubject] = useState('');
  const [unfinished, setUnfinished] = useState(false);
  const [showPaused, setShowPaused] = useState(false);
  if (active.isError || index.isError) return <p>{m.study_error()}</p>;
  if (active.isPending || index.isPending)
    return (
      <div className="flex flex-col gap-lg">
        <Panel title={m.study_plan()}>
          <div className="flex flex-wrap items-center gap-sm">
            <fieldset className="flex flex-wrap items-center gap-sm">
              <legend className="sr-only">{m.study_subjects()}</legend>
              {[{ key: '', label: m.study_all() }, ...studySubjects(active.data ?? [])].map((item) => (
                <Toggle
                  key={item.key}
                  label={item.label}
                  pressed={subject === item.key}
                  onChange={() => setSubject(item.key)}
                />
              ))}
            </fieldset>
            <Toggle label={m.study_unfinished()} pressed={unfinished} onChange={setUnfinished} />
          </div>
          <output aria-label={m.tile_loading()} className="flex flex-col gap-xs">
            <span aria-hidden className="flex h-2xl gap-px">
              {[0, 1, 2, 3].map((item) => (
                <span
                  key={item}
                  className="min-w-0 flex-1 rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse"
                />
              ))}
            </span>
            <span aria-hidden className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
          </output>
        </Panel>
      </div>
    );
  if (!active.data?.length || !index.data) return <EmptyState title={m.study_no_plan()} />;
  const headers = active.data;
  const subjects = studySubjects(headers);
  // Phases belong to one plan: with several active plans the days group by week of study order (decision 15).
  const single = headers.length === 1 ? headers[0] : undefined;
  const all = [...index.data.days, ...index.data.hiddenDays];
  const source = showPaused ? all : index.data.days;
  const visible = source.filter((day) => (!subject || day.subject === subject) && (!unfinished || !day.done));
  const phases = single?.phases.length ? single.phases : [{ id: '', title: m.study_no_phase() }];
  const currentId = index.data.current ?? undefined;
  const titles = new Map(all.map((day) => [day.key, day]));
  const currentShown = visible.some((day) => day.key === currentId);
  let week = 0;
  return (
    <div className="flex flex-col gap-lg">
      <Panel
        title={
          single
            ? `${m.study_plan()} · ${single.title}`
            : `${m.study_plan()} · ${m.study_plan_count({ count: headers.length })}`
        }
        action={
          <span className="text-caption text-muted-foreground tabular-nums">
            {m.study_count({ total: index.data.days.length, done: all.filter((day) => day.done).length })}
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-sm">
          <fieldset className="flex flex-wrap items-center gap-sm">
            <legend className="sr-only">{m.study_subjects()}</legend>
            {[{ key: '', label: m.study_all() }, ...subjects].map((item) => (
              <Toggle
                key={item.key}
                label={item.label}
                pressed={subject === item.key}
                onChange={() => setSubject(item.key)}
              />
            ))}
          </fieldset>
          <Toggle label={m.study_unfinished()} pressed={unfinished} onChange={setUnfinished} />
          {index.data.hiddenDays.length > 0 && (
            <Toggle label={m.study_show_paused()} pressed={showPaused} onChange={setShowPaused} />
          )}
        </div>
        {visible.length > 0 && <DayStrip days={visible} subjects={subjects} currentId={currentId} />}
      </Panel>
      <section aria-label={m.study_days()} data-panel className="flex flex-col gap-lg rounded-lg bg-muted p-lg">
        {visible.length === 0 && <EmptyState title={m.study_empty()} />}
        {phases.map((phase) => {
          const phaseDays = single ? visible.filter((day) => (day.phase ?? '') === phase.id) : visible;
          if (!phaseDays.length) return null;
          const groups = Array.from({ length: Math.ceil(phaseDays.length / WEEK) }, (_, i) =>
            phaseDays.slice(i * WEEK, i * WEEK + WEEK),
          );
          return (
            <section key={phase.id} className="flex flex-col gap-xs">
              {phases.length > 1 && <h3 className="text-title">{phase.title}</h3>}
              {groups.map((group) => {
                week += 1;
                return (
                  <PlanGroup
                    key={`${phase.id}-${group[0]?.key}-${currentId}`}
                    title={m.study_week_range({ number: week, range: range(group) })}
                    days={group}
                    headers={headers}
                    subjects={subjects}
                    titles={titles}
                    currentId={currentId}
                    first={!currentShown && week === 1}
                  />
                );
              })}
            </section>
          );
        })}
      </section>
    </div>
  );
}

function range(days: StudyDay[]) {
  const numbers = days.flatMap((day) => (day.g === null ? [] : [day.g]));
  if (!numbers.length) return m.study_paused();
  const first = numbers[0];
  const last = numbers.at(-1);
  return first === last ? `G${first}` : `G${first}–G${last}`;
}

function Toggle({ label, pressed, onChange }: { label: string; pressed: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
      className="h-touch cursor-pointer rounded-full border border-border px-md text-label text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent"
    >
      {label}
    </button>
  );
}

/** Every visible day as one cell in study order: subject shade, done in the accent, the current day ringed. */
function DayStrip({ days, subjects, currentId }: { days: StudyDay[]; subjects: StudySubject[]; currentId?: string }) {
  const first = days[0]?.g;
  const last = days.at(-1)?.g;
  return (
    <div className="flex flex-col gap-xs">
      <div aria-hidden="true" className="flex h-2xl gap-px">
        {days.map((day) => (
          <span
            key={day.key}
            className={`min-w-0 flex-1 rounded-sm ${day.done ? 'bg-accent' : subjectShade(subjects, day.subject)} ${day.key === currentId ? 'ring-2 ring-accent ring-inset' : ''}`}
          />
        ))}
      </div>
      <div className="flex items-center justify-between gap-md text-caption text-muted-foreground tabular-nums">
        <span>{first ? `G${first}` : ''}</span>
        <span className="flex flex-wrap items-center gap-lg">
          {subjects.map((item) => (
            <span key={item.key} className="flex items-center gap-xs">
              <span aria-hidden="true" className={`size-icon-sm rounded-sm ${subjectShade(subjects, item.key)}`} />
              {item.label}
            </span>
          ))}
          <span className="flex items-center gap-xs">
            <span aria-hidden="true" className="size-icon-sm rounded-sm bg-accent" />
            {m.study_done()}
          </span>
        </span>
        <span>{last ? `G${last}` : ''}</span>
      </div>
    </div>
  );
}
