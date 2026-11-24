import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import * as React from 'react';
import { Diamond as DiamondIcon, X as XIcon } from '@phosphor-icons/react';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { localDay } from '../../apps/web/src/lib/day.ts';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { effectiveApplicationStatus } from './applications.ts';
import { copy } from './copy.ts';
import type { ApplicationStatus } from './schema.ts';
import type { JobRow } from './server.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

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

export function TimelineView({
  jobs,
  now,
  onOpenDetail,
}: {
  jobs: JobRow[];
  now: number;
  onOpenDetail: (key: string) => void;
}) {
  const [compact, setCompact] = React.useState(false);

  // Compute time bounds across all applications
  const { minTime, maxTime } = React.useMemo(() => {
    let min = now - 30 * DAY_MS;
    let max = now;

    for (const j of jobs) {
      if (!j.application) continue;
      if (j.application.appliedAt < min) min = j.application.appliedAt;
      const end = j.application.closedAt ?? now;
      if (end > max) max = end;
      for (const inv of j.application.interviews ?? []) {
        if (inv.scheduledAt > max) max = inv.scheduledAt;
        if (inv.scheduledAt < min) min = inv.scheduledAt;
      }
    }
    // Add small padding to time bounds
    const range = Math.max(max - min, DAY_MS * 7);
    return { minTime: min - range * 0.05, maxTime: max + range * 0.05 };
  }, [jobs, now]);

  const totalRange = maxTime - minTime;
  const getPercent = (time: number) => {
    if (totalRange <= 0) return 0;
    const p = ((time - minTime) / totalRange) * 100;
    return Math.max(0, Math.min(100, p));
  };

  return (
    <div className="flex flex-col gap-sm rounded-xl border border-border bg-surface p-md">
      {/* Timeline Controls */}
      <div className="flex items-center justify-between border-b border-border/40 pb-sm">
        <span className="text-caption font-medium text-muted-foreground">
          <NumberRoll value={jobs.length} /> candidature nel periodo
        </span>
        <div className="flex items-center gap-xs">
          <button
            type="button"
            onClick={() => setCompact((c) => !c)}
            className={`cursor-pointer rounded-full px-sm py-2xs text-caption font-medium transition-colors ${
              compact
                ? 'border border-primary bg-primary/10 text-primary'
                : 'border border-border text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {compact ? copy.candidature.timeline.compact : copy.candidature.timeline.normal}
          </button>
        </div>
      </div>

      {/* Timeline Rows */}
      <div className="flex flex-col divide-y divide-border/30">
        {jobs.map((job) => {
          if (!job.application) return null;
          const app = job.application;
          const effStatus = effectiveApplicationStatus(app, now);
          const startPercent = getPercent(app.appliedAt);
          const endTime = app.closedAt ?? now;
          const endPercent = getPercent(endTime);
          const widthPercent = Math.max(endPercent - startPercent, 2);
          const daysElapsed = Math.max(1, Math.round((endTime - app.appliedAt) / DAY_MS));
          const tone = statusTone(effStatus);

          return (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- row opens detail and preserves layout. // guard-private: allow Generic lint rule name
            <div
              key={job.key}
              onClick={() => onOpenDetail(job.key)}
              className={`group flex cursor-pointer items-center justify-between gap-md rounded-lg transition-colors select-none hover:bg-muted/40 ${
                compact ? 'px-sm py-2xs' : 'px-md py-sm'
              }`}
            >
              {/* Left Column: Job & Company info */}
              <div className="w-64 flex min-w-0 shrink-0 flex-col">
                <div className="flex items-center gap-xs">
                  <span className="truncate text-label font-semibold text-foreground group-hover:text-primary">
                    {job.company}
                  </span>
                  <Badge size="sm" tone={tone} outline>
                    {copy.candidature.status[effStatus]}
                  </Badge>
                </div>
                <span className="truncate text-caption text-muted-foreground">{job.title}</span>
              </div>

              {/* Middle Column: Timeline Bar Track */}
              <div className="relative flex h-xl flex-1 items-center">
                {/* Horizontal baseline guide */}
                <div className="absolute inset-x-0 h-px bg-border/40" />

                {/* Duration bar */}
                <div
                  style={{
                    left: `${startPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                  className={`absolute h-sm rounded-full transition-all ${
                    effStatus === 'interviewing'
                      ? 'border border-primary/60 bg-primary/40'
                      : effStatus === 'offer'
                        ? 'border border-accent/60 bg-accent/40'
                        : effStatus === 'rejected'
                          ? 'border border-danger/60 bg-danger/40'
                          : effStatus === 'expired'
                            ? 'bg-warning/40 border-warning/60 border'
                            : 'border border-muted-foreground/50 bg-muted-foreground/30'
                  }`}
                />

                {/* Diamond markers for interviews */}
                {(app.interviews ?? []).map((inv) => {
                  const invPercent = getPercent(inv.scheduledAt);
                  const dateStr = localDay(new Date(inv.scheduledAt));
                  return (
                    <div
                      key={inv.id}
                      style={{ left: `${invPercent}%` }}
                      className="absolute flex -translate-x-1/2 cursor-pointer items-center justify-center"
                    >
                      <Tooltip content={`${inv.label ?? ''} (${dateStr})`.trimStart()}>
                        <button
                          type="button"
                          aria-label={`${inv.label ?? ''} (${dateStr})`.trimStart()}
                          className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus:outline-none"
                        >
                          <DiamondIcon weight="fill" className="size-sm text-primary drop-shadow-sm" />
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}

                {/* Cross marker for rejection */}
                {effStatus === 'rejected' && app.closedAt && (
                  <div
                    style={{ left: `${endPercent}%` }}
                    className="absolute flex -translate-x-1/2 cursor-pointer items-center justify-center text-danger"
                  >
                    <Tooltip content={copy.candidature.status.rejected}>
                      <button
                        type="button"
                        aria-label={copy.candidature.status.rejected}
                        className="flex cursor-pointer items-center justify-center border-0 bg-transparent p-0 focus:outline-none"
                      >
                        <XIcon weight="bold" className="size-sm text-danger" />
                      </button>
                    </Tooltip>
                  </div>
                )}
              </div>

              {/* Right Column: Days Elapsed */}
              <div className="w-20 flex shrink-0 justify-end">
                <span className="rounded-full bg-muted/60 px-xs py-3xs text-caption font-medium text-muted-foreground tabular-nums">
                  {copy.candidature.timeline.elapsed(daysElapsed)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
