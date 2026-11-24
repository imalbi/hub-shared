import { z } from '../../apps/server/src/core/module.ts';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';
import type { WorkMode } from './work-mode.ts';

// Indeed through the mobile app's GraphQL API, unofficial and unversioned: read plans/refs/job-radar-wire-formats.md
// before changing the query or the mapping. The listing carries the description, so this source has no `describe`.
// Every error message below is built from a status, an API error code or a fixed phrase: never from a body, a header
// or the position of a failure, because the engine and the logs may show it and the headers hold the app's key.

const API = 'https://apis.indeed.com/graphql';
const PAGE_SIZE = 100;
// Indeed answers BAD_USER_INPUT for a third page (seen on the first real dry run), so a term stops at two.
const MAX_RESULTS = 200;
const REMOTE_ATTRIBUTE = 'DSQF7';
const HYBRID_ATTRIBUTE = 'PAXZC';

// Only the key and the title make a posting. Everything else is optional and, when it has an unexpected type, is
// dropped alone: the endpoint is unofficial and a drift in one field must not empty a whole search.
const optional = <T extends z.ZodType>(schema: T) => schema.nullish().catch(undefined);
const jobSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  sourceEmployerName: optional(z.string()),
  datePublished: optional(z.number()),
  description: optional(z.object({ html: optional(z.string()) })),
  location: optional(z.object({ admin1Code: optional(z.string()), city: optional(z.string()) })),
  attributes: optional(z.array(z.object({ key: z.string() }))),
  employer: optional(z.object({ name: optional(z.string()) })),
  recruit: optional(z.object({ viewJobUrl: optional(z.string()) })),
});
type Job = z.infer<typeof jobSchema>;
const resultSchema = z.object({ job: jobSchema });

const responseSchema = z.object({
  data: z
    .object({
      jobSearch: z
        .object({
          pageInfo: z.object({ nextCursor: z.string().nullish() }).nullish(),
          // Parsed one by one: a posting that does not fit is skipped, not the whole page.
          results: z.array(z.unknown()),
        })
        .nullish(),
    })
    .nullish(),
  errors: z
    .array(z.object({ message: z.string().nullish(), extensions: z.object({ code: z.string().nullish() }).nullish() }))
    .nullish()
    .catch(undefined),
});

/** The GraphQL document of the app's search. Terms, place and cursor go in as JSON string literals. */
export function buildQuery({
  term,
  location,
  hoursOld,
  limit,
  cursor,
}: {
  term: string;
  location: string;
  hoursOld: number;
  limit: number;
  cursor?: string;
}) {
  const after = cursor === undefined ? '' : `cursor: ${JSON.stringify(cursor)} `;
  return `query GetJobData {
  jobSearch(what: ${JSON.stringify(term)} location: {where: ${JSON.stringify(location)}, radius: 50, radiusUnit: MILES} limit: ${limit} ${after}sort: RELEVANCE filters: [{ date: { field: "dateOnIndeed", start: "${Math.ceil(hoursOld)}h" } }]) {
    pageInfo { nextCursor }
    results { job {
      key title sourceEmployerName datePublished
      description { html }
      location { countryCode admin1Code city }
      attributes { key }
      employer { name }
      recruit { viewJobUrl }
    } }
  }
}`;
}

const fail = (message: string) => new Error(`indeed: ${message}`);

/** What the API said went wrong, as codes only: a message can echo the search term, which stays out of the log. */
function reasons(errors: z.infer<typeof responseSchema>['errors']) {
  const parts = (errors ?? []).slice(0, 3).flatMap((error) => (error.extensions?.code ? [error.extensions.code] : []));
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
}

/** A link to the employer's own page: http(s) only, and not Indeed's (that is the posting itself). */
function applyLink(raw: string | null | undefined) {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    return web && host !== 'indeed.com' && !host.endsWith('.indeed.com') ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function createIndeedSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  // One inert document for all cleaning: `cleanHtml` only creates detached elements in it.
  const document = parseHTML('<!doctype html><html><body></body></html>').document;

  function toCard(job: Job, domain: string): Card {
    const description = cleanHtml(document, job.description?.html ?? '');
    const keys = new Set((job.attributes ?? []).map((attribute) => attribute.key));
    const mode: WorkMode | undefined = keys.has(HYBRID_ATTRIBUTE)
      ? 'hybrid'
      : keys.has(REMOTE_ATTRIBUTE)
        ? 'remote'
        : undefined;
    const posted =
      job.datePublished === undefined || job.datePublished === null ? undefined : new Date(job.datePublished);
    const applyUrl = applyLink(job.recruit?.viewJobUrl);
    return {
      url: `https://${domain}/viewjob?jk=${encodeURIComponent(job.key)}`,
      title: job.title,
      company: job.employer?.name || job.sourceEmployerName || '',
      location: [job.location?.city, job.location?.admin1Code, 'Italy'].filter(Boolean).join(', '),
      site: 'indeed',
      ...(posted && !Number.isNaN(posted.getTime()) ? { postedAt: posted } : {}),
      ...(description.text === '' ? {} : { description: description.text, descriptionHtml: description.html }),
      ...(mode ? { declaredMode: mode } : {}),
      ...(applyUrl ? { applyUrl } : {}),
    };
  }

  /** One request. Throws an error that is safe to show, or the original one when the collection was cancelled. */
  async function readPage(
    query: string,
    access: NonNullable<SourceContext['sources']['indeed']>,
    context: SourceContext,
  ) {
    // Wall-clock on purpose: this guards a hung connection, it is not a pause the fake clock should drive.
    const timeout = AbortSignal.timeout(requestTimeoutMs);
    let response: Response;
    let text: string;
    try {
      response = await fetchBounded(context.fetch, API, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'accept-language': access.locale,
          'indeed-api-key': access.apiKey,
          'indeed-co': access.country,
          'indeed-locale': access.locale,
          'user-agent': access.userAgent,
          'indeed-app-info': access.appInfo,
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.any([context.signal, timeout]),
      });
      text = await readBoundedText(response);
    } catch (error) {
      if (context.signal.aborted) throw error;
      throw fail(
        timeout.aborted ? 'request timed out' : `request failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
    let body: unknown;
    let isJson = true;
    try {
      body = JSON.parse(text);
    } catch {
      isJson = false;
    }
    const parsed = responseSchema.safeParse(body);
    if (!response.ok) throw fail(`HTTP ${response.status}${parsed.success ? reasons(parsed.data.errors) : ''}`);
    if (!isJson) throw fail('response is not JSON');
    if (!parsed.success) throw fail('unexpected response');
    const search = parsed.data.data?.jobSearch;
    if (!search) throw fail(`no jobSearch in response${reasons(parsed.data.errors)}`);
    return { results: search.results, next: search.pageInfo?.nextCursor ?? undefined };
  }

  async function searchTerm(
    term: string,
    input: SearchInput,
    access: NonNullable<SourceContext['sources']['indeed']>,
    context: SourceContext,
  ): Promise<SearchResult> {
    const found: Card[] = [];
    let cursor: string | undefined;
    let knownPages = 0;
    const max = Math.min(input.maxResults, MAX_RESULTS);
    try {
      while (found.length < max && !context.signal.aborted) {
        const limit = Math.min(max - found.length, PAGE_SIZE);
        const query = buildQuery({ term, location: input.location, hoursOld: input.hoursOld, limit, cursor });
        const page = await readPage(query, access, context);
        const cards = page.results.flatMap((result) => {
          const job = resultSchema.safeParse(result);
          return job.success ? [toCard(job.data.job, access.domain)] : [];
        });
        // Results that all fail to read mean the format moved: say so, instead of looking like a quiet day.
        if (page.results.length > 0 && cards.length === 0)
          throw fail(`none of the ${page.results.length} results could be read`);
        found.push(...cards.slice(0, max - found.length));
        if (cards.length > 0) knownPages = cards.some((card) => !context.isKnown(card.url)) ? 0 : knownPages + 1;
        cursor = page.next;
        if (cards.length === 0 || !cursor) break;
        if (input.knownPagesToStop > 0 && knownPages >= input.knownPagesToStop) break;
      }
    } catch (error) {
      // A cancelled collection drops what this returns, so there is nothing to report.
      if (context.signal.aborted) return { cards: found };
      const safe = error instanceof Error && error.message.startsWith('indeed: ') ? error : fail('unexpected failure');
      context.log.warn(safe.message);
      return { cards: found, error: safe };
    }
    return { cards: found };
  }

  return {
    name: 'indeed',
    kind: 'search',
    async search(input, context) {
      const access = context.sources.indeed;
      if (!access) return { cards: [], error: fail('credentials missing in the config') };
      // Indeed ignores OR and quotes, so each term is its own series; without terms the keywords are all there is.
      const terms = input.query.indeedTerms.length > 0 ? input.query.indeedTerms : [input.query.keywords];
      const cards: Card[] = [];
      const seen = new Set<string>();
      let error: Error | undefined;
      for (const [index, term] of terms.entries()) {
        if (context.signal.aborted) break;
        const result = await searchTerm(term, input, access, context);
        // Counts only: the term itself is the owner's search wording and stays out of the log.
        context.log.info(
          { term: index + 1, terms: terms.length, cards: result.cards.length, failed: result.error !== undefined },
          'Indeed term done',
        );
        for (const card of result.cards)
          if (!seen.has(card.url)) {
            seen.add(card.url);
            cards.push(card);
          }
        error ??= result.error;
      }
      return error ? { cards, error } : { cards };
    },
  };
}
