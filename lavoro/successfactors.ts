import { parseHTML } from 'linkedom';
import { z } from '../../apps/server/src/core/module.ts';
import { sourceRequest } from './source-request.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

const SITE = 'successfactors';
const fail = (message: string) => new Error(`${SITE}: ${message}`);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');

type Item = { id: string; url: string; title: string; location: string };
export function readPage(document: Document, host: string): { items: Item[]; total: number; pageSize: number } {
  const tiles = [...document.querySelectorAll('li.job-tile[data-url]')];
  const elements = tiles.length ? tiles : [...document.querySelectorAll('tr.data-row')];
  const label = squash(
    tiles.length ? document.querySelector('#tile-search-results-label')?.textContent : document.body?.textContent,
  );
  const counts = tiles.length
    ? /(?:da\s+)?(\d+)\s+a\s+(\d+)\s+di\s+(\d+)/iu.exec(label)
    : /risultati\s+(\d+)\s*[–-]\s*(\d+)\s+di\s+(\d+)/iu.exec(label);
  if (
    !elements.length &&
    /nessun[ao]?\s+(?:risultat[oi]|offert[ae]|posizion[ei])/iu.test(squash(document.body?.textContent))
  )
    return { items: [], total: 0, pageSize: 0 };
  if (!elements.length || !counts) throw fail('the search layout changed');
  const start = Number(counts[1]);
  const end = Number(counts[2]);
  const total = Number(counts[3]);
  const items = elements.flatMap((element) => {
    const href = tiles.length
      ? element.getAttribute('data-url')
      : element.querySelector('a.jobTitle-link')?.getAttribute('href');
    const match = /^\/job\/[^/?#]+\/(\d+)\/?(?:[?#].*)?$/u.exec(href ?? '');
    const title = squash(element.querySelector('a.jobTitle-link')?.textContent);
    const location = squash(
      (tiles.length
        ? element.querySelector('[id$="-section-multilocation-value"]')
        : element.querySelector('.jobLocation')
      )?.textContent,
    ).replace(/,\s*IT$/iu, '');
    if (!match || !title || !location) return [];
    const path = (href ?? '').split(/[?#]/u)[0];
    return [{ id: match[1] ?? '', url: `https://${host}${path}`, title, location }];
  });
  return { items, total, pageSize: end - start + 1 };
}

const unifiedPage = z.object({
  totalJobs: z.number().int().nonnegative(),
  jobSearchResult: z
    .array(
      z.object({
        response: z.object({
          id: z.union([z.string().regex(/^\d+$/u), z.number().int().nonnegative()]).transform(String),
          unifiedStandardTitle: z.string().min(1),
          unifiedUrlTitle: z.string().min(1),
          jobLocationShort: z.array(z.string()),
        }),
      }),
    )
    .optional(),
});
export function readUnified(
  value: unknown,
  host: string,
  locale: string,
): { items: Item[]; total: number; pageSize: number } {
  const parsed = unifiedPage.safeParse(value);
  if (!parsed.success || !/^[a-z]{2}_[A-Z]{2}$/u.test(locale)) throw fail('invalid unified listing');
  const items = (parsed.data.jobSearchResult ?? []).map(({ response: item }) => ({
    id: item.id,
    title: item.unifiedStandardTitle,
    location: item.jobLocationShort.join('; '),
    url: `https://${host}/job/${encodeURIComponent(item.unifiedUrlTitle)}/${item.id}-${locale}/`,
  }));
  return { items, total: parsed.data.totalJobs, pageSize: items.length };
}

export function readDetail(
  document: Document,
  cleaner: Document,
): Pick<Card, 'description' | 'descriptionHtml' | 'postedAt'> {
  const raw = [...document.querySelectorAll('[itemprop="description"]')].map((element) => element.innerHTML).join('');
  const cleaned = cleanHtml(cleaner, raw);
  const date = document.querySelector('[itemprop="datePosted"]');
  const value = date?.getAttribute('content') ?? date?.getAttribute('datetime') ?? date?.textContent ?? '';
  const postedAt = new Date(value);
  return {
    ...(cleaned.text ? { description: cleaned.text, descriptionHtml: cleaned.html } : {}),
    ...(!Number.isNaN(postedAt.getTime()) ? { postedAt } : {}),
  };
}

export function createSuccessFactorsSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
    const settings = context.limits.successfactors;
    if (!settings) throw new Error('search.successfactors is required');
    const request = sourceRequest(SITE, context, requestTimeoutMs);
    let last = Number.NEGATIVE_INFINITY;
    async function get(url: string): Promise<Document> {
      for (let attempt = 0; ; attempt++) {
        const delay = last + 1000 - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchBounded(context.fetch, url, {
            headers: desktopHeaders,
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
          return parseHTML(await readBoundedText(response)).document;
        } catch {
          throw fail('request failed');
        }
      }
    }
    const cards: Card[] = [];
    const seen = new Set<string>();
    let firstError: Error | undefined;
    // A cap that stopped a listing before its stated total leaves postings unread: not the whole listing.
    let capped = false;
    for (const employer of settings.employers) {
      try {
        const found: Item[] = [];
        try {
          for (const place of settings.places) {
            let start = 0;
            let received = 0;
            const ids = new Set<string>();
            let done = false;
            for (let page = 0; page < settings.maxPages; page++) {
              const params = new URLSearchParams({ q: '', locationsearch: place, startrow: String(start) });
              const result =
                employer.mode === 'unified'
                  ? readUnified(
                      JSON.parse(
                        await request(`https://${employer.host}/services/recruiting/v1/jobs`, {
                          method: 'POST',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({
                            keywords: '',
                            locale: employer.locale,
                            location: place,
                            pageNumber: page,
                            sortBy: 'recent',
                          }),
                        }),
                      ),
                      employer.host,
                      employer.locale ?? '',
                    )
                  : readPage(await get(`https://${employer.host}/search/?${params}`), employer.host);
              if (employer.mode === 'unified') {
                received += result.items.length;
                if (!result.items.length && received < result.total) throw fail('incomplete unified listing');
                for (const item of result.items) {
                  if (ids.has(item.id)) throw fail('incomplete unified listing');
                  ids.add(item.id);
                }
              }
              found.push(...result.items);
              start += result.pageSize;
              if (!result.pageSize || start >= result.total) {
                done = true;
                break;
              }
            }
            if (!done) capped = true;
          }
        } catch (error) {
          if (context.signal.aborted) throw error;
          const current =
            error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('invalid listing');
          firstError ??= current;
          context.log.warn(current.message);
        }
        let fresh = 0;
        let failedDetails = 0;
        for (const item of found) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          const card: Card = {
            url: item.url,
            title: item.title,
            location: item.location,
            company: employer.company,
            site: SITE,
          };
          if (context.isKnown(card.url)) {
            cards.push(card);
            continue;
          }
          fresh++;
          try {
            const detail = readDetail(
              employer.mode === 'unified' ? parseHTML(await request(card.url)).document : await get(card.url),
              cleaner,
            );
            const missing =
              !detail.description || (employer.mode === 'unified' && /^not applicable$/iu.test(item.title.trim()));
            if (missing) failedDetails++;
            cards.push({ ...card, ...detail, ...(missing ? { detailsMissing: true } : {}) });
          } catch (error) {
            if (context.signal.aborted) throw error;
            failedDetails++;
            cards.push({ ...card, detailsMissing: true });
          }
        }
        context.log.info(
          { company: employer.company, read: found.length, fresh, failedDetails },
          'SuccessFactors done',
        );
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
