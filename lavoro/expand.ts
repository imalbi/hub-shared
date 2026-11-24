import type { Profile } from './config.ts';
import type { SearchInput, Source } from './source.ts';

export type Search = {
  site: string;
  /** Undefined when the profile names a site no source is registered for: the search fails, loudly. */
  source: Source | undefined;
  input: SearchInput;
};

/**
 * Every query times every site it lists (its own `sites` or the profile's). A `list` source appears once, with the
 * limits of the first query that lists it: it ignores keywords, so repeating it would only read the same listing.
 */
export function expandSearches(profile: Profile, sources: ReadonlyMap<string, Source>): Search[] {
  const { search } = profile;
  const searches: Search[] = [];
  const listed = new Set<string>();
  for (const query of search.queries) {
    for (const site of new Set(query.sites ?? search.sites)) {
      const source = sources.get(site);
      if (source?.kind === 'list') {
        if (listed.has(site)) continue;
        listed.add(site);
      }
      searches.push({
        site,
        source,
        input: {
          query,
          location:
            query.location ?? (site === 'indeed' ? profile.sources.indeed?.location : undefined) ?? search.location,
          hoursOld: search.hoursOld,
          maxResults: query.maxResults ?? search.maxResultsPerQuery,
          knownPagesToStop: query.knownPagesToStop ?? search.knownPagesToStop,
        },
      });
    }
  }
  return searches;
}
