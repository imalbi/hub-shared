import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { fetchBounded, readBoundedJson } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Profile } from './config.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

const SITE = 'oracle';
const fail = (message: string) => new Error(`${SITE}: ${message}`);
type Employer = Profile['search']['oracle']['employers'][number];
const itemSchema = z.object({
  Id: z.string().regex(/^\d+$/u),
  Title: z.string(),
  PrimaryLocation: z.string(),
  secondaryLocations: z.array(z.object({ Name: z.string() })),
  PostedDate: z.iso.date(),
  ShortDescriptionStr: z.string(),
});
const pageSchema = z.object({
  items: z.tuple([z.object({ TotalJobsCount: z.number().int().nonnegative(), requisitionList: z.array(itemSchema) })]),
});
const detailSchema = z.object({
  items: z.tuple([
    z.object({
      ExternalDescriptionStr: z.string(),
      ExternalQualificationsStr: z.string(),
      ExternalResponsibilitiesStr: z.string(),
    }),
  ]),
});
const base = (employer: Employer) => `https://${employer.host}/hcmRestApi/resources/latest/`;
export function listUrl(employer: Employer, offset: number): string {
  const params = new URLSearchParams({
    onlyData: 'true',
    expand: 'requisitionList.secondaryLocations',
    finder: `findReqs;siteNumber=${employer.site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`,
  });
  return `${base(employer)}recruitingCEJobRequisitions?${params}`;
}
export function detailUrl(employer: Employer, id: string): string {
  const params = new URLSearchParams({
    expand: 'all',
    onlyData: 'true',
    finder: `ById;Id="${id}",siteNumber=${employer.site}`,
  });
  return `${base(employer)}recruitingCEJobRequisitionDetails?${params}`;
}
const stripCountry = (place: string) => place.replace(/(?:,\s*)?\b(?:Italy|Italia)$/iu, '').trim();

export function readPage(value: unknown, employer: Employer): { cards: Card[]; total: number } {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) throw fail('the search response changed');
  const page = parsed.data.items[0];
  return {
    total: page.TotalJobsCount,
    cards: page.requisitionList.map((item) => {
      const locations = item.secondaryLocations.map((location) => location.Name).filter(Boolean);
      const seen = new Set<string>();
      const places: string[] = [];
      for (const raw of [item.PrimaryLocation, ...locations]) {
        const cleaned = stripCountry(raw);
        if (!cleaned) continue;
        const key = cleaned.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        places.push(cleaned);
      }
      return {
        url: `https://${employer.host}/hcmUI/CandidateExperience/it/sites/${employer.site}/job/${item.Id}`,
        title: item.Title,
        company: employer.company,
        location: places.join(', '),
        site: SITE,
        postedAt: new Date(item.PostedDate),
        description: [locations.length ? `Altre sedi: ${locations.join(', ')}` : '', item.ShortDescriptionStr]
          .filter(Boolean)
          .join('\n'),
      };
    }),
  };
}
export function createOracleSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
    let last = Number.NEGATIVE_INFINITY;
    async function get(url: string): Promise<unknown> {
      for (let attempt = 0; ; attempt++) {
        const delay = last + 1000 - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchBounded(context.fetch, url, {
            headers: { ...desktopHeaders, Accept: 'application/json' },
            signal: AbortSignal.any([context.signal, timeout]),
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          throw fail(timeout.aborted ? 'request timed out' : 'request failed');
        } finally {
          last = context.now();
        }
        if (response.status === 429) {
          await response.body?.cancel();
          const wait = retryAfter(response.headers.get('retry-after'), context.now());
          if (attempt >= 2 || wait > 120_000) throw fail('HTTP 429');
          context.reportWait?.(SITE, Math.ceil(wait / 1000));
          try {
            await context.sleep(wait);
          } finally {
            context.reportWait?.(SITE, null);
          }
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw fail(`HTTP ${response.status}`);
        }
        try {
          return await readBoundedJson(response);
        } catch {
          throw fail('the search response changed');
        }
      }
    }
    const cards: Card[] = [];
    const seen = new Set<string>();
    let firstError: Error | undefined;
    let capped = false;
    for (const employer of context.limits.oracle.employers) {
      try {
        const found: Card[] = [];
        let done = false;
        for (let page = 0; page < context.limits.oracle.maxPages; page++) {
          const result = readPage(await get(listUrl(employer, page * 25)), employer);
          found.push(...result.cards);
          if ((page + 1) * 25 >= result.total) {
            done = true;
            break;
          }
        }
        if (!done) capped = true;
        let fresh = 0;
        let failedDetails = 0;
        for (const card of found) {
          if (seen.has(card.url)) continue;
          seen.add(card.url);
          if (context.isKnown(card.url)) {
            cards.push(card);
            continue;
          }
          fresh++;
          try {
            const id = card.url.slice(card.url.lastIndexOf('/') + 1);
            const result = detailSchema.safeParse(await get(detailUrl(employer, id)));
            if (!result.success) throw fail('the detail response changed');
            const raw = result.data.items[0];
            const cleaned = cleanHtml(
              cleaner,
              [raw.ExternalDescriptionStr, raw.ExternalQualificationsStr, raw.ExternalResponsibilitiesStr]
                .filter(Boolean)
                .join(''),
            );
            if (!cleaned.text) throw fail('the detail response changed');
            const secondary = card.description?.split('\n')[0]?.startsWith('Altre sedi: ')
              ? card.description.split('\n')[0]
              : '';
            const heading = cleaner.createElement('p');
            heading.textContent = secondary;
            cards.push({
              ...card,
              description: [secondary, cleaned.text].filter(Boolean).join('\n'),
              descriptionHtml: `${secondary ? heading.outerHTML : ''}${cleaned.html}`,
            });
          } catch (error) {
            if (context.signal.aborted) throw error;
            failedDetails++;
            cards.push({ ...card, detailsMissing: true });
          }
        }
        context.log.info({ company: employer.company, read: found.length, fresh, failedDetails }, 'Oracle done');
      } catch (error) {
        if (context.signal.aborted) return { cards };
        const safe =
          error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('unexpected failure');
        firstError ??= safe;
        context.log.warn(safe.message);
      }
    }
    return { cards, ...(firstError ? { error: firstError } : {}), complete: !firstError && !capped };
  }
  return { name: SITE, kind: 'list', search };
}
