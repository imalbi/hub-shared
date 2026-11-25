import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CaretDownIcon } from '@phosphor-icons/react';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { DayBody } from './day-body.tsx';
import { m } from './copy.ts';
import {
  subjectShade,
  useStudyTRPC,
  type StudyDay,
  type StudyDayBody as Body,
  type StudyHeader,
  type StudySubject,
} from './use-study.ts';

/** A week of days: a disclosure that loads day bodies only while open (decision 11), rows open in place, read-only. */
export function PlanGroup({
  title,
  days,
  headers,
  subjects,
  titles,
  currentId,
  first = false,
}: {
  title: string;
  days: StudyDay[];
  headers: StudyHeader[];
  subjects: StudySubject[];
  titles: Map<string, StudyDay>;
  currentId?: string;
  /** Opens this group when no visible group holds the current day (a filter on another plan or subject). */
  first?: boolean;
}) {
  const hasCurrent = days.some((day) => day.key === currentId);
  const [open, setOpen] = useState(hasCurrent || first);
  const [openDays, setOpenDays] = useState(() => new Set(hasCurrent && currentId ? [currentId] : []));
  const panelId = useId();
  const trpc = useStudyTRPC();
  const bodies = useQuery(trpc.daysById.queryOptions({ keys: days.map((day) => day.key) }, { enabled: open }));
  const byKey = new Map(bodies.data?.map((day) => [day.key, day]));
  function toggleDay(id: string) {
    const next = new Set(openDays);
    if (!next.delete(id)) next.add(id);
    setOpenDays(next);
  }
  return (
    <div className="border-b border-dashed border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
        className="flex min-h-touch w-full cursor-pointer items-center gap-xs rounded-md text-left text-caption text-muted-foreground uppercase hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <CaretDownIcon aria-hidden="true" className={`size-icon-sm transition-transform ${open ? '' : '-rotate-90'}`} />
        {title}
      </button>
      {open && (
        <ul id={panelId} className="flex flex-col pb-sm">
          {bodies.isError && <li className="text-body">{m.study_error()}</li>}
          {days.map((day) => (
            <DayRow
              key={day.key}
              day={day}
              header={headers.find((item) => item.id === day.planId)}
              subjects={subjects}
              titles={titles}
              body={byKey.get(day.key)}
              current={day.key === currentId}
              open={openDays.has(day.key)}
              onToggle={() => toggleDay(day.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DayRow({
  day,
  header,
  subjects,
  titles,
  body,
  current,
  open,
  onToggle,
}: {
  day: StudyDay;
  header?: StudyHeader;
  subjects: StudySubject[];
  titles: Map<string, StudyDay>;
  body?: Body;
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const g = day.g === null ? m.study_paused() : `G${day.g}`;
  const subject = subjects.find((item) => item.key === day.subject);
  const bodyId = useId();
  const trpc = useStudyTRPC();
  const focus = useQuery(trpc.focusMinutes.queryOptions());
  const studied = focus.data?.[`study/${day.key}`] ?? 0;
  const queries = useQueryClient();
  const navigate = useNavigate();
  const select = useMutation(trpc.setCurrent.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  return (
    <li
      className={
        current
          ? 'my-xs rounded-lg border border-accent bg-muted px-md'
          : 'border-b border-dashed border-border px-md last:border-b-0'
      }
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={`${g} · ${day.title}`}
        onClick={onToggle}
        className="flex min-h-touch w-full cursor-pointer items-center gap-md py-xs text-left focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className={`w-2xl tabular-nums ${current ? 'text-label' : 'text-muted-foreground'}`}>{g}</span>
        <span
          aria-hidden="true"
          className={`flex size-icon shrink-0 items-center justify-center rounded-sm text-caption ${subjectShade(subjects, day.subject)}`}
        >
          {subject?.label.charAt(0)}
        </span>
        <span className={`min-w-0 flex-1 truncate ${current ? 'text-title' : 'text-body'}`}>{day.title}</span>
        {day.kind === 'mock' && (
          <Badge outline size="sm">
            {m.study_kind_mock()}
          </Badge>
        )}
        {day.kind === 'review' && (
          <Badge outline size="sm">
            {m.study_kind_review()}
          </Badge>
        )}
        {current && (
          <Badge tone="primary" size="sm">
            {m.study_current()}
          </Badge>
        )}
        {day.done && (
          <Badge tone="success" size="sm">
            {m.study_done()}
          </Badge>
        )}
        {studied > 0 && (
          <span className="text-caption text-muted-foreground tabular-nums">
            {m.study_focus_minutes({ minutes: studied.toLocaleString('it') })}
          </span>
        )}
        {day.minutes !== undefined && (
          <span className="w-label-col text-right text-caption text-muted-foreground tabular-nums">
            {m.study_minutes({ minutes: day.minutes })}
          </span>
        )}
        <CaretDownIcon aria-hidden="true" className={`size-icon-sm transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id={bodyId} className="border-t border-dashed border-border py-md">
          {body && header ? (
            <DayBody body={body} header={header} titles={titles} />
          ) : (
            <div className="flex flex-col gap-md">
              <LoadingSkeleton label={m.tile_loading()} rows={1} className="w-3xl" />
              <div aria-hidden className="flex flex-col gap-sm rounded-lg border border-border p-md">
                <span className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
                <span className="h-touch rounded-md bg-muted-foreground/20 motion-safe:animate-pulse" />
                <span className="h-touch rounded-md bg-muted-foreground/20 motion-safe:animate-pulse" />
              </div>
            </div>
          )}
          {!day.done && day.g !== null && (
            <div className="mt-md flex gap-sm">
              <button
                type="button"
                className="min-h-touch rounded-full border border-border px-md text-label"
                onClick={() => select.mutate({ key: day.key })}
              >
                {m.study_set_current()}
              </button>
              <button
                type="button"
                className="min-h-touch rounded-full border border-border px-md text-label"
                onClick={() => {
                  void select.mutateAsync({ key: day.key }).then(() => navigate({ to: '/desk/studio' }));
                }}
              >
                {m.study_open_today()}
              </button>
              {select.isError && <span role="alert">{m.study_save_failed()}</span>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
