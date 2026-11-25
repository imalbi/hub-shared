import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { Fragment, useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { Link } from '@tanstack/react-router';
import { CaretRightIcon, CheckIcon, FolderIcon } from '@phosphor-icons/react';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { m } from './copy.ts';
import { studySubjects, useStudyTRPC, type StudyHeader, type StudyIndex } from './use-study.ts';
import { StudyMix } from './mix.tsx';
import { SubjectEstimate } from './subject-estimate.tsx';

const PREVIEW = 4;

function issueText(message: string) {
  if (message === 'Duplicate id') return m.study_issue_duplicate();
  if (message === 'Unknown subject') return m.study_issue_subject();
  if (message === 'Unknown thread') return m.study_issue_thread();
  if (message === 'Unknown day') return m.study_issue_day();
  if (message === 'Invalid phase') return m.study_issue_phase();
  if (message.includes('received undefined')) return m.study_issue_required();
  if (message.startsWith('Unable to read')) return m.study_issue_unreadable();
  return m.study_issue_invalid();
}

export function StudyPlans() {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const active = useQuery(trpc.active.queryOptions());
  const index = useQuery(trpc.index.queryOptions());
  const inbox = useSubscription(trpc.onInbox.subscriptionOptions());
  const activate = useMutation(trpc.activate.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const subject = useMutation(trpc.setSubject.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const paused = useQuery(trpc.paused.queryOptions());
  const setPlan = useMutation(trpc.setPlan.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  if (active.isError || index.isError || inbox.error || paused.isError) return <p>{m.study_error()}</p>;
  const headers = active.data ?? [];
  const data = index.data;
  const subjects = studySubjects(headers);
  // A phase suggests a mix for its own plan's subjects: offered only while that plan is the one active (decision 15).
  const single = headers.length === 1 ? headers[0] : undefined;
  const current = data?.days.find((day) => day.key === data.current);
  const phaseMix = single?.phases.find((phase) => phase.id === current?.phase)?.mix;
  const suggested =
    single && phaseMix
      ? Object.fromEntries(Object.entries(phaseMix).map(([id, share]) => [`${single.id}:${id}`, share]))
      : undefined;
  return (
    <div className="grid grid-cols-12 items-start gap-lg">
      <div className="col-span-7 flex flex-col gap-lg">
        {active.isPending || index.isPending ? (
          <Panel>
            <LoadingSkeleton label={m.tile_loading()} rows={3} />
          </Panel>
        ) : headers.length > 0 && data ? (
          headers.map((header) => (
            <ActivePlan
              key={header.id}
              header={header}
              index={data}
              single={headers.length === 1}
              onPause={() => setPlan.mutateAsync({ id: header.id, active: false })}
            />
          ))
        ) : (
          <Panel>
            <EmptyState title={m.study_no_plan()} />
          </Panel>
        )}
        {inbox.data?.map((item) => (
          <section
            key={item.name}
            aria-label={item.valid ? m.study_found() : m.study_invalid()}
            data-panel
            className="flex flex-col gap-md rounded-lg bg-muted p-lg"
          >
            <div className="flex flex-wrap items-center gap-sm">
              <Badge tone={item.valid ? 'primary' : 'danger'}>{item.valid ? m.study_found() : m.study_invalid()}</Badge>
              {item.valid && (
                <span className="flex items-center gap-2xs text-caption text-muted-foreground">
                  <CheckIcon aria-hidden="true" className="size-icon-sm" />
                  {m.study_valid()}
                </span>
              )}
              <span className="flex-1" />
              <span className="text-caption text-muted-foreground">{m.study_from({ name: item.name })}</span>
            </div>
            <h3 className="text-heading">{item.title ?? item.name}</h3>
            {item.valid ? (
              <>
                <p className="text-caption text-muted-foreground tabular-nums">
                  {m.study_found_meta({ days: item.days, version: item.version ?? 1 })}
                </p>
                <ol>
                  {item.preview.map((title, i) => (
                    <li
                      key={`${i}-${title}`}
                      className="flex items-center gap-md border-b border-dashed border-border py-xs last:border-b-0"
                    >
                      <span className="w-2xl text-muted-foreground tabular-nums">G{i + 1}</span>
                      <span className="text-body">{title}</span>
                    </li>
                  ))}
                </ol>
                {item.days > PREVIEW && (
                  <p className="text-caption text-muted-foreground">
                    {m.study_more_days({ count: item.days - PREVIEW })}
                  </p>
                )}
                <div className="flex items-center gap-md">
                  <RegistryButton label={m.study_activate()} action={() => activate.mutateAsync({ name: item.name })} />
                  {active.data && (
                    <p className="flex-1 text-caption text-muted-foreground">{m.study_activate_note()}</p>
                  )}
                </div>
              </>
            ) : (
              <ul className="flex flex-col gap-2xs">
                {item.issues.map((issue, i) => (
                  <li key={`${issue.path}-${i}`} className="text-caption text-muted-foreground">
                    {[item.name, issue.file, issue.path].filter(Boolean).join(' / ')}: {issueText(issue.message)}
                  </li>
                ))}
                {item.remainingIssues > 0 && (
                  <li className="text-caption">{m.study_more_issues({ count: item.remainingIssues })}</li>
                )}
              </ul>
            )}
          </section>
        ))}
      </div>
      <div className="col-span-5 flex flex-col gap-lg">
        {headers.length > 0 && data && (
          <Panel title={m.study_subjects()}>
            <ul>
              {subjects.map((item) => {
                const status = data.states[item.key] ?? 'active';
                const off = status !== 'active';
                return (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-md border-b border-dashed border-border py-sm last:border-b-0"
                  >
                    <span className="flex flex-col gap-2xs">
                      <span className="flex items-center gap-sm text-body">
                        {item.label}
                        <Badge outline size="sm">
                          {status === 'passed' ? m.study_passed() : off ? m.study_paused() : m.study_active()}
                        </Badge>
                      </span>
                      <SubjectEstimate id={item.key} index={data} />
                    </span>
                    <RegistryButton
                      secondary
                      label={off ? m.study_resume() : m.study_pause()}
                      action={() =>
                        subject.mutateAsync({ plan: item.planId, id: item.id, state: off ? 'active' : 'paused' })
                      }
                    />
                    {status !== 'passed' && (
                      <RegistryButton
                        secondary
                        label={m.study_pass()}
                        action={() => subject.mutateAsync({ plan: item.planId, id: item.id, state: 'passed' })}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
            <StudyMix
              key={`${data.planIds.join()}-${JSON.stringify(data.mix)}`}
              subjects={subjects.map((item) => ({ id: item.key, name: item.label }))}
              mix={data.mix}
              hours={data.weeklyHours}
              suggested={suggested}
              states={data.states}
            />
          </Panel>
        )}
        {paused.data && paused.data.length > 0 && (
          <Panel title={m.study_paused_plans()}>
            <ul>
              {paused.data.map((plan) => (
                <li
                  key={plan.id}
                  className="flex items-center justify-between gap-md border-b border-dashed border-border py-sm last:border-b-0"
                >
                  <span className="text-body">{plan.title}</span>
                  <RegistryButton
                    secondary
                    label={m.study_resume()}
                    action={() => setPlan.mutateAsync({ id: plan.id, active: true })}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        )}
        <section data-panel className="flex flex-col gap-sm rounded-lg bg-muted p-lg">
          <h3 className="flex items-center gap-xs text-caption text-muted-foreground uppercase">
            <FolderIcon aria-hidden="true" className="size-icon" />
            {m.study_folder()}
          </h3>
          <div className="flex items-center gap-sm">
            <Badge outline>{m.study_folder_name()}</Badge>
            <span className="text-caption text-muted-foreground">{m.study_schema()}</span>
          </div>
          <p className="text-caption text-muted-foreground">{m.study_folder_hint()}</p>
        </section>
      </div>
    </div>
  );
}

function ActivePlan({
  header,
  index,
  single,
  onPause,
}: {
  header: StudyHeader;
  index: StudyIndex;
  single: boolean;
  onPause: () => Promise<unknown>;
}) {
  const titleId = useId();
  const all = [...index.days, ...index.hiddenDays].filter((day) => day.planId === header.id);
  const done = all.filter((day) => day.done).length;
  const current = index.days.find((day) => day.planId === header.id && day.key === index.current);
  const share = header.subjects.reduce((sum, item) => sum + (index.mix?.[`${header.id}:${item.id}`] ?? 0), 0);
  return (
    <section aria-labelledby={titleId} data-panel className="flex flex-col gap-md rounded-lg bg-muted p-lg">
      <div className="flex items-center gap-sm">
        <Badge tone="primary">{m.study_active_plan()}</Badge>
        {!single && index.mix && (
          <span className="text-caption text-muted-foreground tabular-nums">
            {m.study_plan_share({ share: Math.round(share) })}
          </span>
        )}
        <span className="flex-1" />
        {!single && <RegistryButton secondary label={m.study_pause_plan()} action={onPause} />}
        <Link
          to="/desk/studio"
          search={{ tab: 'piano' }}
          className="flex h-touch items-center gap-xs rounded-full border border-border px-md text-label hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {m.study_open_plan()}
          <CaretRightIcon aria-hidden="true" className="size-icon-sm" />
        </Link>
      </div>
      <h2 id={titleId} className={single ? 'text-display' : 'text-heading'}>
        {header.title}
      </h2>
      <p className="flex flex-wrap gap-lg text-caption text-muted-foreground tabular-nums">
        <span>{m.study_g_total({ total: all.length })}</span>
        <span>{m.study_version({ version: header.version })}</span>
        {current?.g && <span>{m.study_current_g({ g: current.g })}</span>}
      </p>
      <div className="flex flex-col gap-xs">
        <div className="flex items-center justify-between gap-md">
          <span className="text-body tabular-nums">{m.study_done_of({ done, total: all.length })}</span>
          <span className="text-caption text-muted-foreground tabular-nums">
            {header.subjects.map((item, index) => {
              const days = all.filter((day) => day.subject === `${header.id}:${item.id}`);
              return (
                <Fragment key={item.id}>
                  {index > 0 && ' · '}
                  {item.name} <NumberRoll value={days.filter((day) => day.done).length} />/
                  <NumberRoll value={days.length} />
                </Fragment>
              );
            })}
          </span>
        </div>
        <div aria-hidden="true" className="h-2xs overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-accent" style={{ width: `${(done * 100) / Math.max(1, all.length)}%` }} />
        </div>
      </div>
    </section>
  );
}
