import { PinnedResources } from './resources.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { Ticks } from '../../apps/web/src/components/ticks.tsx';
import { TabBarActions } from '../../apps/web/src/shell/header-slot.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { PomodoroPanel } from '../../apps/web/src/modules/pomodoro/desk-panel.tsx';
import { m } from './copy.ts';
import { DayBody } from './day-body.tsx';
import { causeLabel, ErrorForm } from './error-form.tsx';
import { TodayNote } from './today-note.tsx';
import {
  studySubjects,
  useCurrentStudyDay,
  useStudySteps,
  useStudyTRPC,
  type StudyDayBody,
  type StudyHeader,
  type StudyIndex,
  type StudyProgressRow,
} from './use-study.ts';
import { setCurrentRecord } from '../../apps/web/src/lib/current-record.ts';

export function StudyToday() {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const study = useCurrentStudyDay();
  const open = useMutation(
    trpc.openToday.mutationOptions({ onSuccess: () => queries.invalidateQueries({ queryKey: trpc.index.queryKey() }) }),
  );
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && study.index) {
      opened.current = true;
      open.mutate();
    }
  }, [study.index, open]);
  if (study.isError) return <p>{m.study_error()}</p>;
  if (study.isPending)
    return (
      <section data-study-day className="col-span-6 flex min-w-0 flex-col gap-lg pr-lg">
        <h2 className="text-hero">
          <span
            aria-hidden
            className="inline-block h-xl w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse"
          />
        </h2>
        <p className="flex items-center gap-sm text-caps">
          <span aria-hidden className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
        </p>
        <output aria-label={m.tile_loading()} className="flex flex-col gap-md">
          {[0, 1, 2].map((item) => (
            <span key={item} aria-hidden className="flex items-center gap-sm">
              <span className="size-icon rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
              <span className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
            </span>
          ))}
        </output>
      </section>
    );
  if (!study.index || !study.index.current)
    return (
      <>
        <EmptyState className="col-span-6" title={m.study_no_plan()} />
        <PomodoroPanel className="col-span-6" />
      </>
    );
  if (!study.day || !study.header) return <EmptyState title={m.study_empty()} />;
  return (
    <TodayDay
      key={study.day.key}
      day={study.day}
      header={study.header}
      index={study.index}
      records={study.records ?? []}
      headers={study.headers ?? []}
    />
  );
}

function TodayDay({
  day,
  header,
  index,
  records,
  headers,
}: {
  day: StudyDayBody;
  header: StudyHeader;
  index: StudyIndex;
  records: StudyProgressRow[];
  headers: StudyHeader[];
}) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const { allSteps, checked, failed, saveStep } = useStudySteps(day, records);
  // shortcut: polls while Oggi is open because a focus ends on the server; a study push would replace it.
  const minutes = useQuery(trpc.focusMinutes.queryOptions(undefined, { refetchInterval: 3000 }));
  const errors = useQuery(trpc.errors.queryOptions());
  const [errorDraft, setErrorDraft] = useState<{ reference: string } | null>(null);
  const autonomy = useMutation(
    trpc.setAutonomy.mutationOptions({
      onSuccess: () => queries.invalidateQueries({ queryKey: trpc.progress.queryKey() }),
    }),
  );
  const subject = useMutation(trpc.setSubject.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const open = useMutation(trpc.openToday.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const own = records.filter((item) => item.planId === day.planId);
  const subjects = studySubjects(headers);
  const current = index.days.find((item) => item.key === day.key);
  const currentNumber = current?.g;
  useEffect(() => {
    setCurrentRecord({
      source: 'study-days',
      id: day.key,
      title: currentNumber === undefined ? day.title : m.study_today_line({ g: currentNumber, title: day.title }),
    });
    return () => setCurrentRecord(null);
  }, [day.key, day.title, currentNumber]);
  const subjectInfo = subjects.find((item) => item.key === current?.subject);
  const titles = new Map([...index.days, ...index.hiddenDays].map((item) => [item.key, item]));
  return (
    <div className="col-span-12 grid grid-cols-12 items-start gap-lg">
      <TabBarActions>
        <div className="ml-auto flex items-center gap-md text-caps text-muted-foreground">
          {subjectInfo && (
            <span>
              {m.study_subject_header({
                subject: subjectInfo.label,
                day: current?.g ?? 0,
                total: index.days.filter((entry) => entry.subject === current?.subject).length,
              })}
            </span>
          )}
          {subjectInfo && (
            <div>
              <Select
                label={m.study_select_status()}
                hideLabel
                block={false}
                size="sm"
                // The Select shows its label above, not beside the value: the pill itself says what it is the state of.
                display={(option) => `${m.study_select_status()}: ${option?.label ?? ''}`}
                value={index.states[subjectInfo.key] ?? 'active'}
                onValueChange={(value) => {
                  if (value === 'active' || value === 'paused' || value === 'passed')
                    subject.mutate({ plan: day.planId, id: subjectInfo.id, state: value });
                }}
                options={[
                  { value: 'active', label: m.study_active() },
                  { value: 'paused', label: m.study_paused() },
                  { value: 'passed', label: m.study_passed() },
                ]}
              />
            </div>
          )}
        </div>
      </TabBarActions>
      <section data-study-day className="col-span-6 flex min-w-0 flex-col gap-lg pr-lg">
        <h2 className="text-hero">{day.title}</h2>
        <p className="flex items-center gap-sm text-caps">
          <Ticks value={checked.size} total={allSteps.length} />
          <span>
            <NumberRoll value={checked.size} /> {m.study_steps_of({ total: allSteps.length })}
          </span>
        </p>
        <DayBody
          body={day}
          instrument
          header={header}
          titles={titles}
          checked={checked}
          onStep={saveStep}
          notes={new Map(own.filter((row) => row.kind === 'note').map((row) => [row.id, row.value]))}
          errors={errors.data}
          onError={(item) =>
            setErrorDraft({
              reference: item.file ? `${item.file.path}${item.file.page ? `, p. ${item.file.page}` : ''}` : '',
            })
          }
        />
        {errorDraft ? (
          <ErrorForm
            key={errorDraft.reference}
            dayKey={day.key}
            reference={errorDraft.reference}
            retryDays={index.days.filter((item) => !item.done).slice(0, 60)}
            onDone={() => setErrorDraft(null)}
          />
        ) : (
          <div>
            <button
              type="button"
              className="min-h-touch cursor-pointer rounded-full border border-border px-md text-label hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
              onClick={() => setErrorDraft({ reference: '' })}
            >
              {m.study_error_add()}
            </button>
          </div>
        )}
        {(errors.data ?? [])
          .filter((entry) => entry.key === day.key)
          .map((entry) => (
            <p key={entry.id} className="text-caption text-muted-foreground">
              {m.study_errors()}: {entry.reference} · {causeLabel(entry.cause)}
            </p>
          ))}
        {Object.entries(failed).map(([id, done]) => (
          <div role="alert" key={id}>
            {m.study_save_failed()}{' '}
            <button type="button" className="underline" onClick={() => saveStep(id, done)}>
              {m.study_retry()}
            </button>
          </div>
        ))}
        <TodayNote
          key={day.key}
          dayKey={day.key}
          initial={own.find((row) => row.kind === 'note' && row.id === day.id)?.value ?? ''}
        />
        {day.done && <RegistryButton label={m.study_next()} action={() => open.mutateAsync()} />}
      </section>
      <section data-study-dial className="col-span-3 flex min-w-0 flex-col gap-xl border-l border-border px-lg">
        <PomodoroPanel
          instrument
          tag={`study/${day.key}`}
          footer={m.study_focus_minutes({ minutes: (minutes.data?.[`study/${day.key}`] ?? 0).toLocaleString('it') })}
        />
        <PinnedResources scope={{ planId: day.planId, subjectId: day.subject }} />
      </section>
      <section data-study-next className="col-span-3 flex min-w-0 flex-col gap-lg border-l border-border pl-lg">
        <h3 className="text-caps text-muted-foreground">{m.study_next_days()}</h3>
        <ul>
          {index.days
            .filter((item) => !item.done && item.key !== day.key)
            .slice(0, 5)
            .map((item) => (
              <li key={item.key} className="border-b border-dashed border-border py-sm text-body">
                G{item.g} · {item.title}
              </li>
            ))}
        </ul>
        <p>{m.study_done_of({ done: index.days.filter((item) => item.done).length, total: index.days.length })}</p>
        {/* One subject would repeat the line above. */}
        {subjects.length > 1 && (
          <ul>
            {subjects.map((item) => {
              const days = [...index.days, ...index.hiddenDays].filter((entry) => entry.subject === item.key);
              return (
                <li className="text-caption text-muted-foreground" key={item.key}>
                  {item.label} ·{' '}
                  {m.study_done_of({ done: days.filter((entry) => entry.done).length, total: days.length })}
                </li>
              );
            })}
          </ul>
        )}
        {day.threads.length > 0 && (
          <fieldset className="flex flex-col gap-sm">
            <legend className="text-title">{m.study_autonomy()}</legend>
            {header.threads
              .filter((thread) => day.threads.includes(thread.id))
              .map((thread) => (
                <div className="flex items-center justify-between gap-md" key={thread.id}>
                  <span>{thread.title}</span>
                  <div>
                    <Select
                      label={thread.title}
                      hideLabel
                      block={false}
                      size="sm"
                      value={own.find((row) => row.kind === 'autonomy' && row.id === thread.id)?.value ?? 'unset'}
                      onValueChange={(value) => {
                        if (value === 'unset' || value === 'red' || value === 'yellow' || value === 'green')
                          autonomy.mutate({ plan: day.planId, id: thread.id, value });
                      }}
                      options={[
                        { value: 'unset', label: m.study_autonomy_unset() },
                        { value: 'red', label: m.study_autonomy_red() },
                        { value: 'yellow', label: m.study_autonomy_yellow() },
                        { value: 'green', label: m.study_autonomy_green() },
                      ]}
                    />
                  </div>
                </div>
              ))}
          </fieldset>
        )}
      </section>
    </div>
  );
}
