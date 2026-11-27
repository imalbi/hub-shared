import type { DiscoveredDeps } from '../../apps/server/src/core/module.ts';
import type { Run } from '../../apps/server/src/core/exec.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { archiveGone } from './gone.ts';
import type { Profile } from './config.ts';
import { notification } from './copy.ts';
import { expandSearches } from './expand.ts';
import { type Accepted, createKnown, ingestSearch, rank, type DryRunRow } from './ingest.ts';
import { comparisonCompany } from './key.ts';
import { runPools } from './pool.ts';
import { lte } from '../../apps/server/src/core/module-db.ts';
import { collections, knownUrls } from './schema.ts';
import { createScorer } from './score.ts';
import type { Clock, SearchResult, Source, SourceContext } from './source.ts';

export type CollectionKind = 'prova' | 'raccolta';
export type CollectionStatus = 'done' | 'cancelled' | 'failed' | 'partial';

/** What the state shows while a collection runs. */
export type Progress = {
  kind: CollectionKind;
  startedAt: number;
  /** The site of the search that started last. */
  site: string | null;
  searchesDone: number;
  searchesTotal: number;
  newCount: number;
  excludedCount: number;
  failedSearches: number;
  waitingSeconds?: number;
};

export type CollectionDeps = {
  db: Db;
  profile: Profile;
  sources: ReadonlyMap<string, Source>;
  clock: Clock;
  fetch: typeof fetch;
  log: DiscoveredDeps['log'];
  run: Run;
};

const dryRunLimit = 100;

/**
 * One collection from start to finish: expand, run each site's pool, ingest every finished search at once, record
 * the run, then (a real collection only) send the one summary. Never throws for a failing search or source.
 */
export async function runCollection(
  deps: CollectionDeps,
  kind: CollectionKind,
  signal: AbortSignal,
  onProgress: (progress: Progress) => void,
) {
  const { db, profile, clock, log } = deps;
  const startedAt = clock.now();
  // The seen cache only grows otherwise; 0 days switches it off, so nothing is worth keeping.
  if (kind === 'raccolta')
    db.delete(knownUrls)
      .where(lte(knownUrls.seenAt, new Date(startedAt - profile.search.knownDays * 86_400_000)))
      .run();
  const scorer = createScorer(profile);
  const searches = expandSearches(profile, deps.sources);
  const progress: Progress = {
    kind,
    startedAt,
    site: null,
    searchesDone: 0,
    searchesTotal: searches.length,
    newCount: 0,
    excludedCount: 0,
    failedSearches: 0,
  };
  const emit = () => onProgress({ ...progress });
  const waits = new Map<string, number>();
  const reportWait = (key: string, seconds: number | null) => {
    if (seconds === null) waits.delete(key);
    else waits.set(key, seconds);
    progress.waitingSeconds = waits.size ? Math.max(...waits.values()) : undefined;
    emit();
  };
  const sourceContext: SourceContext = {
    signal,
    fetch: deps.fetch,
    now: clock.now,
    sleep: (ms) => clock.sleep(ms, signal),
    log,
    isKnown: createKnown(db, profile.search.knownDays, clock.now),
    limits: profile.search,
    sources: profile.sources,
    stable: profile.stable,
    reportWait: (site, seconds) => reportWait(`source:${site}`, seconds),
  };
  const shared = {
    db,
    scorer,
    profile,
    sourceContext,
    now: clock.now,
    signal,
    dryRun: kind === 'prova',
    blocked: new Set(profile.filter.blockedCompanies.map(comparisonCompany)),
    seen: new Set<string>(),
    claimed: new Set<string>(),
    accepted: new Map<string, Accepted>(),
  };
  const selected: Awaited<ReturnType<typeof ingestSearch>>['selected'] = [];
  const requirements: Record<string, number> = {};
  emit();

  await runPools(
    searches,
    profile.search,
    clock,
    signal,
    async (search) => {
      progress.site = search.site;
      emit();
      let result: SearchResult;
      try {
        result = search.source
          ? await search.source.search(search.input, sourceContext)
          : { cards: [], error: new Error('No source for this site') };
      } catch (error) {
        result = { cards: [], error: error instanceof Error ? error : new Error('Search failed') };
      }
      // A cancelled search is dropped, not half-saved: what earlier searches saved stays.
      if (signal.aborted) return;
      let failed = result.error !== undefined;
      try {
        const saved = await ingestSearch({ ...shared, source: search.source }, result.cards);
        log.info(
          { site: search.site, ...saved.counts, listed: saved.selected.length, excluded: saved.excluded },
          'Lavoro search ingested',
        );
        selected.push(...saved.selected);
        // Only a real collection, a whole listing and a non-empty one: a site answering with nothing is a glitch.
        if (kind === 'raccolta' && result.complete && !result.error && result.cards.length > 0) {
          const archived = archiveGone(
            db,
            search.site,
            new Set(result.cards.map((card) => card.url)),
            new Date(clock.now()),
          );
          if (archived) log.info({ site: search.site, archived }, 'Lavoro postings no longer listed, archived');
        }
        progress.newCount += saved.selected.length;
        progress.excludedCount += saved.excluded;
        for (const [reason, n] of Object.entries(saved.requirements))
          requirements[reason] = (requirements[reason] ?? 0) + n;
      } catch {
        failed = true;
      }
      // Names the site only: an error from a source can carry a URL or a response, which stay out of the log.
      if (failed) log.warn({ site: search.site }, 'Lavoro search failed');
      if (failed) progress.failedSearches++;
      progress.searchesDone++;
      emit();
    },
    (site, seconds) => reportWait(`pool:${site}`, seconds),
  );

  for (const site of new Set(searches.map((search) => search.site))) deps.sources.get(site)?.finish?.(sourceContext);

  let status: CollectionStatus = 'done';
  if (signal.aborted) status = 'cancelled';
  else if (progress.failedSearches > 0)
    status = progress.failedSearches === progress.searchesTotal ? 'failed' : 'partial';
  db.insert(collections)
    .values({
      kind,
      startedAt: new Date(startedAt),
      finishedAt: new Date(clock.now()),
      status,
      newCount: progress.newCount,
      excludedCount: progress.excludedCount,
      searches: progress.searchesTotal,
      failedSearches: progress.failedSearches,
    })
    .run();

  const ranked = rank(selected);
  // After the last save, also when cancelled or partial; a dry run and a run with nothing new stay quiet.
  if (kind === 'raccolta' && ranked.length) {
    const { title, body } = notification(ranked);
    const sent = await deps.run('notify-send', ['--app-name', 'Hub', '--', title, body]);
    if (sent.code !== 0) log.warn('Lavoro notification not delivered');
  }
  const dryRun: DryRunRow[] = ranked.slice(0, dryRunLimit).map(({ at: _at, ...row }) => row);
  return { status, dryRun, requirements };
}
