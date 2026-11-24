import { parseHTML } from 'linkedom';
import { z } from '../../apps/server/src/core/module.ts';
import { fetchBounded, readBoundedJson, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

const SITE = 'synergie';
const ORIGIN = 'https://www.synergie-italia.it';
export const BOOTSTRAP_URL = `${ORIGIN}/candidato/offerte-di-lavoro/offerte-di-lavoro-a-torino`;

const fail = (message: string) => new Error(`${SITE}: ${message}`);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');
// IRENfutura is already collected directly by iren.ts under `Iren tramite Synergie`, so agency reposts duplicate under a different comparisonKey.
const IREN_REPOST_RE = /\b(?:gruppo\s+iren|ireti|irenfutura)\b/iu;

export type AlgoliaConfig = {
  appId: string;
  apiKey: string;
  indexName: string;
};

export function parseAlgoliaConfig(html: string): AlgoliaConfig {
  const appId = /ALGOLIA_APP_ID["']?\s*[:=]\s*["']([A-Za-z0-9]{4,20})["']/u.exec(html)?.[1];
  const apiKey = /ALGOLIA_API_KEY["']?\s*[:=]\s*["']([A-Za-z0-9=+/._-]{8,256})["']/u.exec(html)?.[1];
  const indexName = /ALGOLIA_APPLICATIONS_INDEX_NAME["']?\s*[:=]\s*["']([A-Za-z0-9._-]{1,100})["']/u.exec(html)?.[1];
  if (!appId || !apiKey || !indexName) throw fail('the search layout changed');
  return { appId, apiKey, indexName };
}

const hitSchema = z.object({
  objectID: z.union([z.string(), z.number()]),
  title: z.string(),
  company_name: z.string().nullish(),
  city: z.string().nullish(),
  county: z.string().nullish(),
  region: z.string().nullish(),
  linkKey: z.string().nullish(),
  source_vacancy_url: z.string().nullish(),
  published_from: z.number().nullish(),
  contract_type: z.string().nullish(),
  functional_area: z.string().nullish(),
  remuneration: z.string().nullish(),
  archived: z.union([z.string(), z.number(), z.boolean()]).nullish(),
  description_company_html: z.string().nullish(),
  description_position_html: z.string().nullish(),
  description_requirements_html: z.string().nullish(),
  description_other_info_html: z.string().nullish(),
});

const pageSchema = z.object({
  nbPages: z.number().int().nonnegative(),
  hits: z.array(hitSchema),
});

function buildUrl(hit: z.infer<typeof hitSchema>): string | undefined {
  const direct = squash(hit.source_vacancy_url);
  if (direct.startsWith(`${ORIGIN}/`)) {
    try {
      const parsed = new URL(direct);
      if (parsed.origin === ORIGIN) {
        parsed.search = '';
        parsed.hash = '';
        return parsed.href;
      }
    } catch {
      return undefined;
    }
  }
  const slug = squash(hit.linkKey);
  if (/^[A-Za-z0-9._-]+$/u.test(slug)) {
    return `${ORIGIN}/candidato/offerte-di-lavoro/${slug}`;
  }
  return undefined;
}

export type SynergieRow = { id: string; card: Card };

export function readPage(value: unknown, cleaner: Document): { rows: SynergieRow[]; nbPages: number } {
  const parsed = pageSchema.safeParse(value);
  if (!parsed.success) throw fail('the search response changed');
  const rows: SynergieRow[] = [];

  for (const hit of parsed.data.hits) {
    if (hit.archived === '1' || hit.archived === 1 || hit.archived === true) continue;
    const url = buildUrl(hit);
    const title = squash(hit.title);
    if (!url || !title) continue;

    const seenPlaces = new Set<string>();
    const places: string[] = [];
    for (const raw of [hit.city, hit.county, hit.region]) {
      const place = squash(raw);
      if (!place) continue;
      const key = place.toLowerCase();
      if (seenPlaces.has(key)) continue;
      seenPlaces.add(key);
      places.push(place);
    }

    const company = squash(hit.company_name) || 'Synergie';
    const contract = squash(hit.contract_type);
    const area = squash(hit.functional_area);
    const remuneration = squash(hit.remuneration);
    const metaLines = [
      contract ? `Contratto: ${contract}` : '',
      area ? `Area: ${area}` : '',
      remuneration ? `Retribuzione: ${remuneration}` : '',
    ].filter(Boolean);

    const htmlSections = [
      hit.description_company_html,
      hit.description_position_html,
      hit.description_requirements_html,
      hit.description_other_info_html,
    ]
      .filter((section): section is string => Boolean(section && squash(section)))
      .join('');

    const cleaned = cleanHtml(cleaner, htmlSections);
    const metaParagraphs = metaLines.map((line) => {
      const p = cleaner.createElement('p');
      p.textContent = line;
      return p.outerHTML;
    });

    const description = [...metaLines, cleaned.text].filter(Boolean).join('\n');
    if (IREN_REPOST_RE.test(`${title}\n${description}`)) continue;
    const descriptionHtml = `${metaParagraphs.join('')}${cleaned.html}`;

    let postedAt: Date | undefined;
    if (typeof hit.published_from === 'number' && Number.isFinite(hit.published_from) && hit.published_from > 0) {
      const d = new Date(hit.published_from);
      if (!Number.isNaN(d.getTime())) postedAt = d;
    }

    rows.push({
      id: String(hit.objectID),
      card: {
        url,
        title,
        company,
        location: places.join(', '),
        site: SITE,
        ...(postedAt ? { postedAt } : {}),
        ...(description ? { description } : { detailsMissing: true }),
        ...(descriptionHtml ? { descriptionHtml } : {}),
      },
    });
  }

  return { rows, nbPages: parsed.data.nbPages };
}

export function createSynergieSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;

  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
    let last = Number.NEGATIVE_INFINITY;

    async function request(url: string, init: RequestInit): Promise<Response> {
      for (let attempt = 0; ; attempt++) {
        const delay = last + 1000 - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchBounded(context.fetch, url, {
            ...init,
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
        return response;
      }
    }

    const cards: Card[] = [];
    const seenIds = new Set<string>();
    const seenUrls = new Set<string>();
    let firstError: Error | undefined;
    let capped = false;

    let algolia: AlgoliaConfig;
    try {
      const bootRes = await request(BOOTSTRAP_URL, { method: 'GET', headers: desktopHeaders });
      algolia = parseAlgoliaConfig(await readBoundedText(bootRes));
    } catch (error) {
      if (context.signal.aborted) return { cards };
      const safe = error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('request failed');
      return { cards, error: safe, complete: false };
    }

    const queryUrl = `https://${algolia.appId.toLowerCase()}-dsn.algolia.net/1/indexes/${algolia.indexName}/query`;

    for (const region of context.limits.synergie.regions) {
      try {
        let regionRead = 0;
        let done = false;

        for (let page = 0; page < context.limits.synergie.maxPages; page++) {
          const res = await request(queryUrl, {
            method: 'POST',
            headers: {
              'X-Algolia-Application-Id': algolia.appId,
              'X-Algolia-API-Key': algolia.apiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Referer: `${ORIGIN}/`,
            },
            body: JSON.stringify({
              facetFilters: [[`region:${region}`], ['archived:0']],
              hitsPerPage: 100,
              page,
            }),
          });
          let jsonPayload: unknown;
          try {
            jsonPayload = await readBoundedJson(res);
          } catch {
            throw fail('the search response changed');
          }
          const parsed = readPage(jsonPayload, cleaner);

          for (const row of parsed.rows) {
            if (seenIds.has(row.id) || seenUrls.has(row.card.url)) continue;
            seenIds.add(row.id);
            seenUrls.add(row.card.url);
            cards.push(row.card);
            regionRead++;
          }

          if (page + 1 >= parsed.nbPages) {
            done = true;
            break;
          }
        }
        if (!done) capped = true;
        context.log.info({ region, read: regionRead }, 'Synergie done');
      } catch (error) {
        if (context.signal.aborted) return { cards };
        const safe =
          error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('unexpected failure');
        firstError ??= safe;
        context.log.warn({ region, message: safe.message }, 'Synergie region failed');
      }
    }

    return { cards, ...(firstError ? { error: firstError } : {}), complete: !firstError && !capped };
  }

  return { name: SITE, kind: 'list', search };
}
