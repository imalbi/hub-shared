import { silentLog, testProfile } from './harness.ts';
import type { SourceContext, SearchInput } from './source.ts';

export const input: SearchInput = {
  query: { name: 'Web', keywords: 'frontend', indeedTerms: [] },
  location: 'Exampleville',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};
export function context(fetch: typeof globalThis.fetch, settings: object = {}): SourceContext {
  const profile = testProfile((p) => Object.assign(p.search, settings));
  let now = 0;
  return {
    signal: new AbortController().signal,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
  };
}
