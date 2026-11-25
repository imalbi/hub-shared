import { TabBarRow } from '../../apps/web/src/shell/header-slot.tsx';
import { SurfaceScroller } from '../../apps/web/src/shell/page-surface.tsx';
import * as React from 'react';
import {
  ArrowSquareOut as ArrowSquareOutIcon,
  Cards as CardsIcon,
  ChartBar as ChartBarIcon,
} from '@phosphor-icons/react';
import { useNavigate, useSearch } from '../../apps/web/src/lib/zone-search.ts';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { AnimatedItem, AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import { ButtonGroup } from '../../apps/web/src/components/ui/button-group.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { SearchInput } from '../../apps/web/src/components/ui/search-input.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { effectiveApplicationStatus } from './applications.ts';
import { segmentCounts, selectApplications, type CandidatureSegment } from './candidature-view.ts';
import { copy } from './copy.ts';
import { formatRelativeDate } from './filters.ts';
import { applicationStatuses, type ApplicationStatus } from './application-status.ts';
import { matchesFreeSearch, parseFreeSearch } from './search.ts';
import type { JobRow } from './server.ts';
import { annunciSearchSchema, formatJobTitle } from './ui-common.tsx';
import { MailProposals } from './ui-mail-proposals.tsx';
import { TimelineView } from './ui-timeline.tsx';
import type { MailCheckState } from './mail-check.ts';
import { closesInDays, daysSince } from './waiting.ts';

export type CandidatureViewMode = 'cards' | 'timeline';

const statusOptions = [
  { value: 'any', label: copy.candidature.status_any },
  ...applicationStatuses.map((value) => ({ value, label: copy.candidature.status[value] })),
];

const sortOptions = [
  { value: 'applied_date', label: copy.candidature.sort_applied_date },
  { value: 'type', label: copy.candidature.sort_type },
  { value: 'score', label: copy.sort.score },
  { value: 'company', label: copy.sort.company },
  { value: 'title', label: copy.sort.title },
];

function statusTone(status: ApplicationStatus): 'primary' | 'neutral' | 'success' | 'danger' | 'warning' {
  switch (status) {
    case 'interviewing':
      return 'primary';
    case 'offer':
      return 'success';
    case 'rejected':
      return 'danger';
    case 'withdrawn':
      return 'neutral';
    case 'expired':
      return 'warning';
    case 'pending':
    default:
      return 'neutral';
  }
}

const statusOrder: Record<ApplicationStatus, number> = {
  offer: 0,
  interviewing: 1,
  pending: 2,
  expired: 3,
  rejected: 4,
  withdrawn: 5,
};

function ageLabel(days: number) {
  const { today, yesterday, days_ago } = copy.candidature.card;
  return days === 0 ? today : days === 1 ? yesterday : days_ago(days);
}

const dayFormat = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function formatInterviewDay(ms: number) {
  return `${dayFormat.format(ms)}, ${timeFormat.format(ms)}`;
}

export function CandidaturePage({
  jobs,
  now,
  onOpenDetail,
  mailCheck,
  onChanged,
  loaded = true,
}: {
  jobs: JobRow[];
  now: number;
  onOpenDetail: (key: string) => void;
  mailCheck: MailCheckState | null;
  onChanged: () => void;
  loaded?: boolean;
}) {
  const navigate = useNavigate();
  const surface = React.useContext(SurfaceScroller);
  const scrollTop = () => surface?.current?.scrollTo(0, 0);
  const { candidature: segment, status } = annunciSearchSchema.parse(useSearch({ strict: false }));
  const setSegment = (next: CandidatureSegment) => {
    scrollTop();
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, candidature: next === 'pending' ? undefined : next }),
      replace: true,
      resetScroll: false,
    });
  };
  const setStatus = (next: string) => {
    scrollTop();
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, status: next === 'any' ? undefined : next }),
      replace: true,
      resetScroll: false,
    });
  };
  const [viewMode, setViewMode] = React.useState<CandidatureViewMode>('cards');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [sortOption, setSortOption] = React.useState('applied_date');
  // Filter jobs to only those with an application
  const appliedJobs = React.useMemo(() => {
    return jobs.filter((j) => j.application !== null);
  }, [jobs]);

  const selection = { status, now };
  const counts = segmentCounts(appliedJobs, selection);
  const segmentFiltered = selectApplications(appliedJobs, { ...selection, segment });

  // Search filter
  const parsedSearch = React.useMemo(() => parseFreeSearch(searchQuery), [searchQuery]);
  const searchedJobs = React.useMemo(() => {
    return segmentFiltered.filter((j) => matchesFreeSearch(j, parsedSearch));
  }, [segmentFiltered, parsedSearch]);

  // Sort jobs
  const sortedJobs = React.useMemo(() => {
    return searchedJobs.toSorted((a, b) => {
      const appA = a.application!;
      const appB = b.application!;

      if (sortOption === 'applied_date') {
        return appB.appliedAt - appA.appliedAt;
      }
      if (sortOption === 'type') {
        const effA = effectiveApplicationStatus(appA, now);
        const effB = effectiveApplicationStatus(appB, now);
        const diff = statusOrder[effA] - statusOrder[effB];
        if (diff !== 0) return diff;
        return appB.appliedAt - appA.appliedAt;
      }
      if (sortOption === 'score') {
        return b.total - a.total;
      }
      if (sortOption === 'company') {
        return a.company.localeCompare(b.company);
      }
      if (sortOption === 'title') {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });
  }, [searchedJobs, sortOption, now]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-lg">
      <TabBarRow>
        <div className="flex shrink-0 flex-col gap-md">
          {/* Top Segmented Controls & View Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-md">
            <ButtonGroup
              size="sm"
              variant="outline"
              items={[
                ...(['pending', 'interview'] satisfies CandidatureSegment[]).map((id) => ({
                  id,
                  label: id === 'pending' ? copy.candidature.segment_pending : copy.candidature.segment_interview,
                  active: segment === id,
                  onClick: () => setSegment(id),
                  content: (
                    <span className="flex items-center gap-xs">
                      <span>
                        {id === 'pending' ? copy.candidature.segment_pending : copy.candidature.segment_interview}
                      </span>
                      <span className="rounded-full bg-muted/60 px-xs text-caption tabular-nums">
                        <NumberRoll value={counts[id]} />
                      </span>
                    </span>
                  ),
                })),
                {
                  id: 'closed',
                  label: copy.candidature.segment_closed,
                  active: segment === 'closed',
                  onClick: () => setSegment('closed'),
                  content: (
                    <span className="flex items-center gap-xs">
                      <span>{copy.candidature.segment_closed}</span>
                      <span className="rounded-full bg-muted/60 px-xs text-caption tabular-nums">
                        <NumberRoll value={counts.closed} />
                      </span>
                    </span>
                  ),
                },
                {
                  id: 'all',
                  label: copy.candidature.segment_all,
                  active: segment === 'all',
                  onClick: () => setSegment('all'),
                  content: (
                    <span className="flex items-center gap-xs">
                      <span>{copy.candidature.segment_all}</span>
                      <span className="rounded-full bg-muted/60 px-xs text-caption tabular-nums">
                        <NumberRoll value={counts.all} />
                      </span>
                    </span>
                  ),
                },
              ]}
            />

            {/* View mode toggle (Cards vs Timeline) */}
            <ButtonGroup
              size="sm"
              variant="outline"
              items={[
                {
                  id: 'cards',
                  label: copy.candidature.view_cards,
                  active: viewMode === 'cards',
                  onClick: () => {
                    scrollTop();
                    setViewMode('cards');
                  },
                  content: (
                    <span className="flex items-center gap-xs">
                      <CardsIcon className="size-icon-xs" />
                      <span>{copy.candidature.view_cards}</span>
                    </span>
                  ),
                },
                {
                  id: 'timeline',
                  label: copy.candidature.view_timeline,
                  active: viewMode === 'timeline',
                  onClick: () => {
                    scrollTop();
                    setViewMode('timeline');
                  },
                  content: (
                    <span className="flex items-center gap-xs">
                      <ChartBarIcon className="size-icon-xs" />
                      <span>{copy.candidature.view_timeline}</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>

          {/* Search and Sort Bar */}
          <div className="flex flex-wrap items-center justify-between gap-md py-xs">
            <div className="flex min-w-popover-sm flex-1 items-center gap-xs">
              <SearchInput
                className="flex-1"
                aria-label={copy.search.label}
                placeholder="Cerca per titolo, azienda, note..."
                clearLabel={copy.search.clear}
                shortcut="/"
                value={searchQuery}
                onValueChange={(value) => {
                  scrollTop();
                  setSearchQuery(value);
                }}
              />
            </div>

            <div className="flex items-center gap-sm">
              <output
                aria-label={copy.candidature.count(sortedJobs.length)}
                className="text-label text-muted-foreground"
              >
                <NumberRoll value={sortedJobs.length} /> {copy.candidature.count_label}
              </output>
              <PillSelect
                size="md"
                align="end"
                label={copy.candidature.filter_status}
                options={statusOptions}
                value={status ?? 'any'}
                onValueChange={setStatus}
              />
              <PillSelect
                size="md"
                align="end"
                label={copy.topbar.sort}
                options={sortOptions}
                value={sortOption}
                onValueChange={(value) => {
                  scrollTop();
                  setSortOption(value);
                }}
              />
            </div>
          </div>
        </div>
      </TabBarRow>
      {/* Content Area */}
      <div key={`${segment}-${viewMode}`} className="pb-xl">
        <MailProposals check={mailCheck} onChanged={onChanged} />
        {!loaded ? (
          <LoadingSkeleton variant="centered" label={copy.widget.loading} />
        ) : sortedJobs.length === 0 ? (
          <EmptyState
            title={
              searchQuery || status
                ? copy.empty.filtered_title
                : segment === 'pending'
                  ? copy.candidature.empty_pending_title
                  : segment === 'closed'
                    ? copy.candidature.empty_closed_title
                    : segment === 'interview'
                      ? copy.candidature.empty_interview_title
                      : copy.candidature.empty_all_title
            }
            description={
              searchQuery || status
                ? copy.empty.filtered_description
                : segment === 'pending'
                  ? copy.candidature.empty_pending_description
                  : segment === 'closed'
                    ? copy.candidature.empty_closed_description
                    : segment === 'interview'
                      ? copy.candidature.empty_interview_description
                      : copy.candidature.empty_all_description
            }
            action={
              searchQuery || status
                ? {
                    label: copy.empty.filtered_reset,
                    onAction: () => {
                      setSearchQuery('');
                      setStatus('any');
                    },
                  }
                : undefined
            }
          />
        ) : viewMode === 'timeline' ? (
          <TimelineView jobs={sortedJobs} now={now} onOpenDetail={onOpenDetail} />
        ) : (
          /* Cards View */
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3">
            <AnimatedRows>
              {sortedJobs.map((job) => {
                const app = job.application!;
                const effStatus = effectiveApplicationStatus(app, now);
                const tone = statusTone(effStatus);
                const closesIn = closesInDays(app, now);
                const nextInterview = app.interviews?.find((interview) => interview.scheduledAt >= now) ?? null;
                const lastMail = app.lastMail
                  ? [
                      formatRelativeDate(app.lastMail.at, now),
                      ...(app.lastMail.kind ? [copy.candidature.card.mail_kind[app.lastMail.kind]] : []),
                    ].join(', ')
                  : null;

                return (
                  <AnimatedItem
                    key={job.key}
                    onClick={() => onOpenDetail(job.key)}
                    className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-border bg-surface p-md transition-shadow select-none hover:shadow-md"
                  >
                    <div className="flex flex-col gap-xs">
                      <div className="flex items-center justify-between text-caption text-muted-foreground">
                        <div className="flex items-center gap-xs">
                          <Badge size="sm" tone={tone}>
                            {copy.candidature.status[effStatus]}
                          </Badge>
                          {effStatus === 'expired' && app.status !== 'expired' && (
                            <span className="text-warning text-caption font-medium">(&gt;21 gg)</span>
                          )}
                        </div>
                        {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- stops card click propagation from nested link. -- guard-private: allow Generic lint rule name */}
                        <span onClick={(e) => e.stopPropagation()}>
                          {job.url && job.url.startsWith('http') ? (
                            <Tooltip content={copy.detail.open_original}>
                              <a
                                href={job.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-2xs text-caption text-muted-foreground hover:text-foreground"
                              >
                                <span>{job.site}</span>
                                <ArrowSquareOutIcon className="size-icon-xs" />
                              </a>
                            </Tooltip>
                          ) : (
                            <span>{job.site}</span>
                          )}
                        </span>
                      </div>

                      <div className="mt-xs flex min-w-0 flex-col">
                        <h4 className="truncate text-body font-semibold text-foreground group-hover:text-primary">
                          {formatJobTitle(job.title)}
                        </h4>
                        <span className="truncate text-caption text-muted-foreground">
                          {job.company} • {job.location}
                        </span>
                      </div>
                    </div>

                    {/* Two facts: how long ago it went out, and what came back (or what is planned). */}
                    <div className="mt-sm flex items-end justify-between gap-md border-t border-border pt-xs">
                      <div className="flex flex-col">
                        <span className="text-caption text-muted-foreground">{copy.candidature.card.sent}</span>
                        <span className="text-title text-foreground">{ageLabel(daysSince(app.appliedAt, now))}</span>
                      </div>
                      <div className="flex min-w-0 flex-col items-end text-right">
                        <span className="text-caption text-muted-foreground">
                          {nextInterview ? copy.candidature.card.next : copy.candidature.card.last_mail}
                        </span>
                        {nextInterview ? (
                          <span className="text-label text-foreground">
                            {`${formatInterviewDay(nextInterview.scheduledAt)} ${nextInterview.label ?? ''}`.trimEnd()}
                          </span>
                        ) : (
                          <span className="text-label">
                            <span className={!lastMail ? 'text-muted-foreground' : 'text-foreground'}>
                              {lastMail ?? copy.candidature.card.no_mail}
                            </span>
                            {closesIn !== null && (
                              <span className="text-muted-foreground">{` · ${copy.candidature.card.closes_in(closesIn)}`}</span>
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </AnimatedItem>
                );
              })}
            </AnimatedRows>
          </div>
        )}
      </div>
    </div>
  );
}
