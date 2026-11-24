import type { DiscoveredDeps } from '../../apps/server/src/core/module.ts';
import type { Profile } from './config.ts';
import type { WorkMode } from './work-mode.ts';

// What the engine needs from a source. A real source (16d on) implements this and nothing else: the engine never
// sees HTML, headers or paging. Time and waiting come in through the context, so tests drive them with a fake clock.

/** A posting as a source read it from a listing. `site` is the source's own name. */
export type Card = {
  url: string;
  title: string;
  company: string;
  location: string;
  site: string;
  postedAt?: Date;
  /** Present when the listing already carries it (Indeed); otherwise `describe` is asked for it. */
  description?: string;
  /** The same description cleaned by `clean-html.ts`, kept for the zone (16g). Only a listing that carries HTML has it. */
  descriptionHtml?: string;
  /** The source read the card but not its detail page: saved without its text and judged again next time. */
  detailsMissing?: boolean;
  /** What the source itself declares; it wins over the text (see `work-mode.ts`). */
  declaredMode?: WorkMode;
  remote?: boolean;
  applyUrl?: string;
};

export type Query = Profile['search']['queries'][number];

/** One search of a source: a query with its overrides applied. */
export type SearchInput = {
  query: Query;
  location: string;
  hoursOld: number;
  maxResults: number;
  /** 0 means never stop on known pages. */
  knownPagesToStop: number;
};

/** The cards read so far and, when the search broke off, why: a failing search never loses what it already read. */
export type SearchResult = {
  cards: Card[];
  error?: Error;
  /** A list source read its whole listing for the configured scope (no cap, no error): a saved posting it no longer lists is closed. */
  complete?: boolean;
};

/** Waits `ms` on the injected clock; resolves early when the signal aborts, so callers check `signal.aborted`. */
export type Clock = {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type SourceContext = {
  /** Aborts when the owner cancels: stop reading, return the cards read so far. */
  signal: AbortSignal;
  fetch: typeof fetch;
  now: () => number;
  /** Waiting for throttles and pauses goes through here, never through a timer of the source's own. */
  sleep: (ms: number) => Promise<void>;
  log: DiscoveredDeps['log'];
  /** True for a URL already judged (seen cache, within `knownDays`) or saved: for incremental paging. */
  isKnown: (url: string) => boolean;
  /** The whole `search` section: request caps, throttle and wait budgets live in `limits.linkedin` and its siblings. */
  limits: Profile['search'];
  /** Access to the sources (keys, identity, country), from the local config. A source reads its own entry only. */
  sources: Profile['sources'];
  /** The `stable` section, for the sources that filter on it (inPA skips categories). */
  stable?: Profile['stable'];
  reportWait?: (site: string, seconds: number | null) => void;
};

export type Source = {
  name: string;
  /** `search` runs once per query and site; `list` reads its listing once per collection, whatever the keywords. */
  kind: 'search' | 'list';
  search: (input: SearchInput, context: SourceContext) => Promise<SearchResult>;
  /**
   * The description of a card that came without one, as plain text. The place for a source's request budget: throw
   * when it is spent and the card is saved with `details_missing`, to be judged again next time.
   */
  describe?: (card: Card, context: SourceContext) => Promise<string | { text: string; html: string }>;
  finish?: (context: SourceContext) => void;
};

export const defaultClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal?.addEventListener('abort', done, { once: true });
    }),
};
