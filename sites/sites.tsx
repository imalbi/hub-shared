import { useModuleEnabled } from '../../apps/web/src/lib/module-enabled.ts';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy, useSubscription, type ofFeatureFlags } from '@trpc/tanstack-react-query';
import type { sitesModule } from './server.ts';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { StatusBars, type DayStatus, type StatusBarsCopy } from '../../apps/web/src/components/ui/status-bars.tsx';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { m } from './copy.ts';

type SitesRouter = ReturnType<typeof sitesModule.create>['router'];
const client = createModuleClient<typeof sitesModule>('sites');
function useSitesTRPC() {
  const queryClient = useQueryClient();
  return createTRPCOptionsProxy<SitesRouter, ofFeatureFlags<{ keyPrefix: true }>>({
    client,
    queryClient,
    keyPrefix: 'sites',
  });
}
export function useSites() {
  const trpc = useSitesTRPC();
  return useSubscription(trpc.onState.subscriptionOptions());
}
export function useSitesConfigured(enabled: boolean) {
  const trpc = useSitesTRPC();
  return useQuery(trpc.configured.queryOptions(undefined, { enabled, retry: false, staleTime: Infinity }));
}
function statusLabel(status: DayStatus) {
  return { operational: m.sites_operational, degraded: m.sites_degraded, major: m.sites_major, none: m.sites_none }[
    status
  ]();
}
function overall(status: DayStatus) {
  return { operational: m.sites_all, degraded: m.sites_some_degraded, major: m.sites_some_down, none: m.sites_unknown }[
    status
  ]();
}
const copy: StatusBarsCopy = {
  overall,
  status: statusLabel,
  day: (date, status, minutes) => m.sites_day({ date, status: statusLabel(status), minutes }),
  help: m.sites_help(),
  latency: (ms) => m.sites_latency({ ms }),
  uptime: m.sites_uptime(),
  daysAgo: (days) => m.sites_ago({ days }),
  today: m.sites_today(),
  services: m.sites_title(),
};
export function SitesSection() {
  const sites = useSites();
  if (sites.error) return <p>{m.sites_error()}</p>;
  if (!sites.data) return <LoadingSkeleton label={m.tile_loading()} rows={4} />;
  if (!sites.data.length) return <EmptyState title={m.sites_empty()} />;
  const services = sites.data.map((site) => {
    const status: DayStatus = !site.latest
      ? 'none'
      : site.latest.status === null || site.latest.status >= 400
        ? 'major'
        : 'operational';
    return {
      id: site.url,
      name: site.name,
      status,
      latency: site.latest?.latency ?? null,
      uptime: site.uptime,
      days: site.days.map((day, index) => ({ ...day, status: index === site.days.length - 1 ? status : day.status })),
    };
  });
  return <StatusBars services={services} copy={copy} />;
}
export function SitesWidget() {
  const sites = useSites();
  const down = sites.data?.filter((site) => site.latest && (site.latest.status === null || site.latest.status >= 400));
  return (
    <Panel title={m.sites_title()} className="h-full">
      {sites.error ? (
        m.sites_error()
      ) : !down ? (
        <LoadingSkeleton label={m.tile_loading()} rows={2} />
      ) : down.length ? (
        <ul>
          {down.map((site) => (
            <li key={site.url}>{site.name}</li>
          ))}
        </ul>
      ) : (
        m.sites_no_down()
      )}
    </Panel>
  );
}

export function useSitesAvailable() {
  return useSitesConfigured(useModuleEnabled('sites')).data === true;
}

export function useSitesPending() {
  return useSitesConfigured(useModuleEnabled('sites')).isPending;
}

export function SitesPendingPage() {
  return (
    <output aria-label={m.tile_loading()} className="@container block rounded-xl border border-border bg-background">
      <h2 className="flex items-center gap-sm border-b border-border p-lg text-title">
        <span aria-hidden className="relative">
          <span className="invisible">{m.sites_unknown()}</span>
          <span className="absolute inset-0 rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
        </span>
      </h2>
      <section aria-label={m.sites_title()} className="px-lg">
        <article className="border-b border-border py-md">
          <span aria-hidden className="block h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
          <span
            aria-hidden
            className="mt-sm block h-touch rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse"
          />
        </article>
      </section>
    </output>
  );
}
