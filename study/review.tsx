import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { Checkbox } from '../../apps/web/src/components/ui/checkbox.tsx';
import { m } from './copy.ts';
import { causeLabel, causeOrder, ErrorForm } from './error-form.tsx';
import { studySubjects, subjectShade, useStudyTRPC, type StudyDay, type StudyError } from './use-study.ts';

type Filter = 'all' | 'red' | 'yellow' | 'half' | 'errors';
const THREAD_DAYS = 3;

function ReviewFilters({ filter, onChange }: { filter: Filter; onChange: (value: Filter) => void }) {
  const filters: [Filter, string][] = [
    ['all', m.study_all()],
    ['red', m.study_autonomy_red()],
    ['yellow', m.study_autonomy_yellow()],
    ['half', m.study_review_half()],
    ['errors', m.study_errors()],
  ];
  return (
    <fieldset className="flex flex-wrap items-center gap-sm">
      <legend className="sr-only">{m.study_review_filter()}</legend>
      {filters.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={filter === id}
          onClick={() => onChange(id)}
          className="h-touch cursor-pointer rounded-full border border-border px-md text-label text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none aria-pressed:border-accent aria-pressed:bg-accent/15 aria-pressed:text-accent"
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

export function StudyReview() {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const navigate = useNavigate();
  const active = useQuery(trpc.active.queryOptions());
  const index = useQuery(trpc.index.queryOptions());
  const review = useQuery(trpc.review.queryOptions());
  const errors = useQuery(trpc.errors.queryOptions());
  const select = useMutation(trpc.setCurrent.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const tick = useMutation(trpc.setStep.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<string | null>(null);
  if (active.isError || index.isError || review.isError || errors.isError) return <p>{m.study_error()}</p>;
  if (active.isPending || index.isPending || review.isPending || errors.isPending)
    return (
      <div className="flex flex-col gap-lg">
        <Panel title={m.study_review()}>
          <ReviewFilters filter={filter} onChange={setFilter} />
          <output aria-label={m.tile_loading()} className="flex flex-col">
            {[0, 1, 2].map((item) => (
              <span
                key={item}
                aria-hidden
                className="flex items-center gap-md border-b border-dashed border-border py-sm"
              >
                <span className="size-icon-sm rounded-full bg-muted-foreground/20 motion-safe:animate-pulse" />
                <span className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
                <span className="ml-auto h-touch w-3xl rounded-full bg-muted-foreground/20 motion-safe:animate-pulse" />
              </span>
            ))}
          </output>
        </Panel>
      </div>
    );
  if (!active.data.length || !index.data) return <EmptyState title={m.study_no_plan()} />;
  const subjects = studySubjects(active.data);
  const days = new Map([...index.data.days, ...index.data.hiddenDays].map((day) => [day.key, day]));
  const g = (key: string | null) => (key ? days.get(key)?.g : undefined);
  const openDay = (key: string) => void select.mutateAsync({ key }).then(() => navigate({ to: '/desk/studio' }));
  const threads = review.data.threads.filter((thread) => filter === 'all' || filter === thread.value);
  const half = filter === 'all' || filter === 'half' ? review.data.half : [];
  const toRetry = errors.data
    .filter((entry) => entry.result !== 'solved')
    .toSorted(
      (a, b) =>
        (g(a.retry) ?? Infinity) - (g(b.retry) ?? Infinity) ||
        causeOrder.indexOf(a.cause) - causeOrder.indexOf(b.cause),
    );
  const shownErrors = filter === 'all' || filter === 'errors' ? toRetry : [];
  const solved = errors.data.length - toRetry.length;
  const total = review.data.threads.length + review.data.half.length + toRetry.length;
  const left = half.flatMap((day) => day.open.map((step) => ({ day, step })));
  return (
    <div className="flex flex-col gap-lg">
      <Panel
        title={m.study_review()}
        action={
          <span className="text-caption text-muted-foreground tabular-nums">
            {m.study_review_count({ count: total })}
          </span>
        }
      >
        <ReviewFilters filter={filter} onChange={setFilter} />
        {total === 0 && <EmptyState title={m.study_review_empty()} />}
        {threads.length > 0 && (
          <section aria-label={m.study_review_threads()} className="flex flex-col">
            {threads.map((thread) => {
              const open = thread.days.filter((day) => !day.done);
              const subject = subjects.find(
                (item) =>
                  item.planId === thread.planId &&
                  item.id === days.get(thread.days[0]?.key ?? '')?.subject.split(':')[1],
              );
              return (
                <div
                  key={`${thread.planId}/${thread.id}`}
                  className="flex flex-wrap items-center gap-md border-b border-dashed border-border py-sm last:border-b-0"
                >
                  <span className="flex w-label-col shrink-0 items-center gap-xs text-label">
                    <span
                      aria-hidden="true"
                      className={`size-icon-sm rounded-full ${thread.value === 'red' ? 'bg-danger' : 'bg-foreground/50'}`}
                    />
                    {thread.value === 'red' ? m.study_autonomy_red() : m.study_autonomy_yellow()}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body">{thread.title}</span>
                    <span className="text-caption text-muted-foreground">
                      {subject?.label}
                      {open.length > THREAD_DAYS &&
                        ` · ${m.study_review_more_days({ count: open.length - THREAD_DAYS })}`}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-sm">
                    {open.slice(0, THREAD_DAYS).map((day) => (
                      <OpenDay key={day.key} g={day.g} title={day.title} onOpen={() => openDay(day.key)} />
                    ))}
                  </span>
                </div>
              );
            })}
          </section>
        )}
        {half.length > 0 && (
          <section
            aria-label={m.study_review_half_title()}
            className={`flex flex-col ${threads.length > 0 ? 'border-t border-dashed border-border' : ''}`}
          >
            {half.map((day) => (
              <div
                key={day.key}
                className="flex flex-wrap items-center gap-md border-b border-dashed border-border py-sm last:border-b-0"
              >
                <span className="w-2xl text-caption text-muted-foreground tabular-nums">G{day.g}</span>
                <span
                  aria-hidden="true"
                  className={`flex size-icon shrink-0 items-center justify-center rounded-sm text-caption ${subjectShade(subjects, day.subject)}`}
                >
                  {subjects.find((item) => item.key === day.subject)?.label.charAt(0)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body">{day.title}</span>
                  <span className="text-caption text-muted-foreground">
                    {m.study_review_half_note({ open: day.open.length, total: day.total })}
                  </span>
                </span>
                <OpenDay g={day.g} title={day.title} onOpen={() => openDay(day.key)} />
              </div>
            ))}
          </section>
        )}
      </Panel>
      {left.length > 0 && (
        <Panel title={m.study_review_left()}>
          <p className="text-caption text-muted-foreground">{m.study_review_left_note()}</p>
          <ul>
            {left.map(({ day, step }) => (
              <li
                key={`${day.key}/${step.id}`}
                className="flex items-center gap-md border-b border-dashed border-border py-sm text-body last:border-b-0"
              >
                <span className="w-2xl text-caption text-muted-foreground tabular-nums">G{day.g}</span>
                <Checkbox
                  aria-label={step.text}
                  checked={false}
                  disabled={tick.isPending}
                  onCheckedChange={(done) => tick.mutate({ key: day.key, id: step.id, done })}
                />
                <span className="min-w-0 flex-1">{step.text}</span>
              </li>
            ))}
          </ul>
          {tick.isError && (
            <p role="alert" className="text-caption text-danger">
              {m.study_save_failed()}
            </p>
          )}
        </Panel>
      )}
      {shownErrors.length + solved > 0 && (
        <Panel title={m.study_review_errors()}>
          <ul>
            {shownErrors.map((entry) => (
              <ErrorRow
                key={entry.id}
                entry={entry}
                days={days}
                editing={editing === entry.id}
                onEdit={(on) => setEditing(on ? entry.id : null)}
                retryDays={[...days.values()]
                  .filter((day) => (!day.done && day.g !== null) || day.key === entry.retry)
                  .slice(0, 60)}
              />
            ))}
          </ul>
          {solved > 0 && (
            <p className="text-caption text-muted-foreground">{m.study_error_solved_count({ count: solved })}</p>
          )}
        </Panel>
      )}
    </div>
  );
}

function OpenDay({ g, title, onOpen }: { g: number | null; title: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onOpen}
      className="h-touch cursor-pointer rounded-full border border-border px-md text-label hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {m.study_open_g({ g: g ?? 0 })}
    </button>
  );
}

function ErrorRow({
  entry,
  days,
  editing,
  onEdit,
  retryDays,
}: {
  entry: StudyError;
  days: Map<string, StudyDay>;
  editing: boolean;
  onEdit: (on: boolean) => void;
  retryDays: StudyDay[];
}) {
  const own = days.get(entry.key);
  const retry = entry.retry ? days.get(entry.retry) : undefined;
  return (
    <li className="flex flex-col gap-sm border-b border-dashed border-border py-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-md">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body">{entry.reference}</span>
          <span className="text-caption text-muted-foreground">
            {causeLabel(entry.cause)}
            {own && ` · ${own.g === null ? '' : `G${own.g} · `}${own.title}`}
            {retry?.g !== undefined && retry.g !== null && ` · ${m.study_error_retry_on({ g: retry.g })}`}
            {entry.result === 'again' && ` · ${m.study_error_result_again()}`}
          </span>
          {entry.tried && <span className="text-caption text-muted-foreground">{entry.tried}</span>}
          {entry.method && <span className="text-caption text-muted-foreground">{entry.method}</span>}
        </span>
        {!editing && (
          <button
            type="button"
            aria-label={`${m.study_error_edit()}: ${entry.reference}`}
            onClick={() => onEdit(true)}
            className="h-touch cursor-pointer rounded-full border border-border px-md text-label hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {m.study_error_edit()}
          </button>
        )}
      </div>
      {editing && <ErrorForm dayKey={entry.key} entry={entry} retryDays={retryDays} onDone={() => onEdit(false)} />}
    </li>
  );
}
