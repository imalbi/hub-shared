import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { Readout } from '../../apps/web/src/components/readout.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { useNow } from '../../apps/web/src/lib/use-now.ts';
import type { WidgetSize } from '../../apps/web/src/lib/widget-size.ts';
import { useNavigate } from '../../apps/web/src/lib/zone-search.ts';
import { copy } from './copy.ts';
import { formatCollectionLabel } from './format.ts';
import type definition from './server.ts';
import type { LavoroState } from './server.ts';
import type { LavoroSummaryItem } from './widget-summary.ts';
import { OpinionBadge } from './ui-card-row.tsx';
import { formatJobTitle, ScoreBadge } from './ui-common.tsx';

const primaryLinkClass =
  'inline-flex min-h-touch items-center rounded-full bg-primary px-md text-label whitespace-nowrap text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none';

type LiveSnapshot = {
  lastFinishedAt: number | null;
  pareriDone: number;
  running: boolean;
  mailRunning: boolean;
};

/**
 * Shared Panoramica query and live invalidation for both LavoroWidget and useLavoroToday.
 * Updates reactively via `onState` without a polling interval.
 */
export function useLavoroSummary() {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<LavoroState | null>(null);
  const snapshotRef = React.useRef<LiveSnapshot | null>(null);

  const summary = useQuery({
    queryKey: ['lavoro', 'summary'],
    queryFn: () => client.summary.query(),
  });

  React.useEffect(() => {
    let active = true;
    void client.state.query().then(
      (initial) => {
        if (active) setState(initial);
      },
      (error: unknown) => console.error('Failed to query initial lavoro state:', error),
    );
    const sub = client.onState.subscribe(undefined, {
      onData(next: LavoroState) {
        if (!active) return;
        setState(next);
        if (next.status !== 'ready') return;
        const current: LiveSnapshot = {
          lastFinishedAt: next.last?.finishedAt ?? null,
          pareriDone: next.pareri?.done ?? 0,
          running: Boolean(next.collection),
          mailRunning: Boolean(next.mailCheck?.running),
        };
        const prev = snapshotRef.current;
        snapshotRef.current = current;
        if (!prev) return;
        const changed =
          prev.lastFinishedAt !== current.lastFinishedAt ||
          prev.pareriDone !== current.pareriDone ||
          (prev.running && !current.running) ||
          (prev.mailRunning && !current.mailRunning);
        if (changed) void queryClient.invalidateQueries({ queryKey: ['lavoro', 'summary'] });
      },
    });
    return () => {
      active = false;
      sub.unsubscribe();
    };
  }, [client, queryClient]);

  const running = state?.status === 'ready' && Boolean(state.collection);
  const startCollection = React.useCallback(() => client.raccogli.mutate(), [client]);

  return { summary, running, startCollection };
}

function ZoneLink({
  jobKey,
  className,
  'aria-label': ariaLabel,
  children,
}: {
  jobKey?: string;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const href = jobKey ? `/desk/ricerca?job=${encodeURIComponent(jobKey)}` : '/desk/ricerca';

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        void navigate({
          to: '/desk/$module',
          params: { module: 'ricerca' },
          ...(jobKey ? { search: { job: jobKey } } : {}),
        });
      }}
    >
      {children}
    </a>
  );
}

function SummaryJobRow({ item, showOpinion = true }: { item: LavoroSummaryItem; showOpinion?: boolean }) {
  const place = [item.company, item.location].filter(Boolean).join(' · ');

  return (
    <li className="min-w-0 border-b border-dashed border-border last:border-b-0">
      <ZoneLink
        jobKey={item.key}
        className="flex min-w-0 items-center justify-between gap-sm rounded-sm py-3xs hover:text-foreground focus-visible:outline focus-visible:outline-accent"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label font-medium text-foreground">{formatJobTitle(item.title)}</span>
          <span className="block truncate text-caption text-muted-foreground">{place}</span>
        </span>
        <span className="flex shrink-0 items-center gap-xs">
          {showOpinion && <OpinionBadge opinion={item} />}
          <ScoreBadge score={item.score} />
        </span>
      </ZoneLink>
    </li>
  );
}

/** Lavoro widget on Panoramica in piccolo (3x1), medio (6x1), and grande (6x2). */
export function LavoroWidget({ size }: { size: WidgetSize }) {
  const now = useNow('clock');
  const { summary, running, startCollection } = useLavoroSummary();

  if (summary.isError) {
    return (
      <Panel title={copy.widget.title} className="h-full">
        <p className="mt-auto text-body text-muted-foreground">{copy.widget.error}</p>
      </Panel>
    );
  }

  if (summary.isPending || !summary.data) {
    return (
      <Panel title={copy.widget.title} className="h-full">
        <LoadingSkeleton label={copy.widget.loading} rows={size === 'large' ? 4 : 2} />
      </Panel>
    );
  }

  const data = summary.data;
  const fullCollectionLabel = running ? copy.widget.running : formatCollectionLabel(data.lastCollectionAt, now);

  if (size === 'small') {
    const headerAction = fullCollectionLabel ? (
      <span className="text-muted-foreground tabular-nums">{fullCollectionLabel}</span>
    ) : undefined;
    return (
      <Panel title={copy.widget.title} className="relative h-full" action={headerAction}>
        <ZoneLink
          aria-label={copy.widget.open}
          className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-accent"
        />
        <div className="mt-auto flex min-w-0 items-end justify-between gap-sm">
          <p className="shrink-0">
            <Readout>
              <NumberRoll value={data.review} />
            </Readout>
            <span className="block text-caption text-muted-foreground">{copy.widget.to_review}</span>
          </p>
          <div className="flex min-w-0 flex-col items-end text-right text-label text-muted-foreground tabular-nums">
            <span className="max-w-full truncate">{copy.widget.alta_count(data.byPossibility.alta)}</span>
            <span className="max-w-full truncate">{copy.widget.waiting_short(data.pending)}</span>
          </div>
        </div>
      </Panel>
    );
  }

  if (size === 'medium') {
    const shortCollectionLabel = running
      ? copy.widget.running
      : formatCollectionLabel(data.lastCollectionAt, now, true);
    const preview = data.top.slice(0, 2);

    return (
      <Panel className="h-full">
        <div className="flex min-h-0 flex-1 items-stretch gap-lg">
          <div className="relative flex w-5/12 max-w-[14rem] shrink-0 flex-col justify-between border-r border-border pr-lg">
            <ZoneLink
              aria-label={copy.widget.open}
              className="absolute inset-0 rounded-sm focus-visible:outline focus-visible:outline-accent"
            />
            <div className="flex min-w-0 items-center justify-between gap-xs">
              <h2 className="text-caps text-muted-foreground">{copy.widget.title}</h2>
              {running && <span className="truncate text-caps text-muted-foreground">{copy.widget.running}</span>}
            </div>
            <div>
              <p>
                <Readout>
                  <NumberRoll value={data.review} />
                </Readout>
              </p>
              <p className="truncate text-caption text-muted-foreground tabular-nums">
                {[copy.widget.to_review, shortCollectionLabel].filter(Boolean).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-xs">
            {preview.length > 0 ? (
              <ul className="flex min-w-0 flex-col">
                {preview.map((item) => (
                  <SummaryJobRow key={item.key} item={item} />
                ))}
              </ul>
            ) : (
              <p className="my-auto text-body text-muted-foreground">{copy.widget.empty_top(data.review)}</p>
            )}
            <div className="mt-auto flex min-w-0 items-center justify-between gap-sm">
              <span className="min-w-0 truncate text-label text-muted-foreground tabular-nums">
                {copy.widget.waiting_full(data.pending)}
              </span>
              <RegistryButton
                secondary
                className="shrink-0"
                label={copy.topbar.raccogli}
                action={startCollection}
                disabled={running}
              />
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  const headerParts = [copy.widget.to_review_count(data.review), fullCollectionLabel].filter(Boolean);
  const groups = [
    {
      id: 'alta' as const,
      title: `${copy.stats.opinions.alta} · ${data.byPossibility.alta}`,
      items: data.top.filter((item) => item.possibility === 'alta'),
    },
    {
      id: 'media' as const,
      title: `${copy.stats.opinions.media} · ${data.byPossibility.media}`,
      items: data.top.filter((item) => item.possibility === 'media'),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <Panel
      title={copy.widget.title}
      className="h-full"
      action={<span className="text-muted-foreground tabular-nums">{headerParts.join(' · ')}</span>}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-xs">
        {groups.length > 0 ? (
          groups.map((group) => (
            <div key={group.id} className="flex min-w-0 flex-col">
              <h3 className="text-caps text-muted-foreground">{group.title}</h3>
              <ul className="flex min-w-0 flex-col">
                {group.items.map((item) => (
                  <SummaryJobRow key={item.key} item={item} showOpinion={false} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="my-auto text-body text-muted-foreground">{copy.widget.empty_top(data.review)}</p>
        )}
        <div className="mt-auto flex min-w-0 items-center justify-between gap-sm">
          <span className="min-w-0 truncate text-label text-muted-foreground tabular-nums">
            {`${copy.widget.waiting_short(data.pending)} · ${copy.widget.interviewing_short(data.interviewing)}`}
          </span>
          <div className="flex shrink-0 items-center gap-xs">
            <RegistryButton secondary label={copy.topbar.raccogli} action={startCollection} disabled={running} />
            <ZoneLink className={primaryLinkClass}>{copy.widget.open}</ZoneLink>
          </div>
        </div>
      </div>
    </Panel>
  );
}
