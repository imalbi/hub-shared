import { fileURLToPath } from 'node:url';
import type { Run } from '../../apps/server/src/core/exec.ts';
import type { DiscoveredDeps } from '../../apps/server/src/core/module.ts';
import { count } from '../../apps/server/src/core/module-db.ts';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { runCollection, type CollectionKind, type CollectionDeps, type Progress } from './collect.ts';
import { profileSchema } from './config.ts';
import { createFakeClock } from './fake-clock.ts';
import { inventedProfile, inventedSourceSettings } from './invented-profile.ts';
import { jobs } from './schema.ts';
import type { Source } from './source.ts';

// Shared setup of the engine tests: a module database in memory, a virtual clock, the fake desktop and a profile
// narrowed to what a test needs. Nothing here can reach the network or the real desktop.

const migrations = fileURLToPath(new URL('./drizzle', import.meta.url));
const noop = () => undefined;
export const silentLog: DiscoveredDeps['log'] = {
  level: 'info',
  fatal: noop,
  error: noop,
  warn: noop,
  info: noop,
  debug: noop,
  trace: noop,
  silent: noop,
  child: () => silentLog,
};

/** A log that keeps what it is given, for the tests that pin what is (and is not) logged. */
export function capturingLog() {
  const records: Array<{ level: string; fields: unknown; message: unknown }> = [];
  const capture = (level: string) => (fields: unknown, message?: unknown) =>
    void records.push({ level, fields, message });
  const log: DiscoveredDeps['log'] = {
    ...silentLog,
    debug: capture('debug'),
    info: capture('info'),
    warn: capture('warn'),
    error: capture('error'),
    child: () => log,
  };
  return { log, records };
}

const refuseNetwork: typeof fetch = () => {
  throw new Error('Lavoro tests must not touch the network');
};

/** The invented profile with one query on `indeed` and no pauses; `edit` changes whatever the test is about. */
export function testProfile(edit: (profile: ReturnType<typeof inventedProfile>) => void = noop) {
  const profile = inventedProfile();
  Object.assign(profile.search, structuredClone(inventedSourceSettings));
  profile.search.sites = ['indeed'];
  profile.search.queries = [{ name: 'Web', keywords: 'web', indeedTerms: [] }];
  profile.search.pauseSeconds = 0;
  profile.search.workersPerSite = 1;
  profile.search.workersBySite = { linkedin: 1, indeed: 1, reteinformaticalavoro: 1 };
  edit(profile);
  return profileSchema.parse(profile);
}

export function createHarness({
  sources,
  profile = testProfile(),
  fetch = refuseNetwork,
  log = silentLog,
}: {
  sources: Source[];
  profile?: ReturnType<typeof testProfile>;
  /** Only a test of a real source passes one, serving invented pages; every other test keeps the guard. */
  fetch?: typeof globalThis.fetch;
  log?: DiscoveredDeps['log'];
}) {
  const db = openDatabase(':memory:', migrations);
  const fake = createFakeClock();
  const notifications: string[][] = [];
  /** How many postings were saved at the moment each notification was sent. */
  const savedAtNotification: number[] = [];
  const desktop = createFakeDesktop({ notifications });
  const run: Run = (bin, args) => {
    if (bin === 'notify-send') savedAtNotification.push(db.select({ n: count() }).from(jobs).get()?.n ?? 0);
    return desktop(bin, args);
  };
  const deps: CollectionDeps = {
    db,
    profile,
    sources: new Map(sources.map((source) => [source.name, source])),
    clock: fake.clock,
    fetch,
    log,
    run,
  };

  /** Starts a collection and drives virtual time until it ends; `cancelAfterMs` cancels it that far in. */
  async function collect(kind: CollectionKind = 'raccolta', cancelAfterMs?: number) {
    const controller = new AbortController();
    const progresses: Progress[] = [];
    const done = runCollection(deps, kind, controller.signal, (progress) => progresses.push(progress));
    if (cancelAfterMs !== undefined) {
      await fake.advance(cancelAfterMs);
      controller.abort();
    }
    await fake.drain();
    return { ...(await done), progresses };
  }

  return { db, deps, collect, notifications, savedAtNotification, ...fake };
}

export const rows = (db: ReturnType<typeof createHarness>['db']) => db.select().from(jobs).all();
