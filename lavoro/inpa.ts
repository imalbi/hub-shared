import { z } from '../../apps/server/src/core/module.ts';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedJson } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { plain } from './key.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

// inPA, the national portal of public competitions (16n2). The portal's own search answers a POST without a login:
// the open competitions of one region, newest first, in pages. The API is undocumented and may change, so the answer is
// parsed with zod and a shape that does not parse is the page's error. The list carries everything the engine needs
// (the detail call adds nothing: same text, requirements only in attached PDFs, checked live), so there is no
// `describe`. Errors carry a status or a fixed phrase, never a body, a title or a URL.

const SITE = 'inpa';
const API = 'https://portale.inpa.gov.it/concorsi-smart/api/concorso-public-area/search-better';
const PUBLIC_PAGE = 'https://www.inpa.gov.it/bandi-e-avvisi/dettaglio-bando-avviso/?concorso_id=';
const INTERVAL_MS = 1000;
const RETRIES_AFTER_429 = 2;
const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 120_000;

const fail = (message: string) => new Error(`${SITE}: ${message}`);
const isOurs = (error: unknown): error is Error => error instanceof Error && error.message.startsWith(`${SITE}: `);

const itemSchema = z.object({
  id: z.string().min(1),
  titolo: z.string().min(1),
  figuraRicercata: z.string().nullish(),
  descrizione: z.string().nullish(),
  sedi: z.array(z.string()).nullish(),
  entiRiferimento: z.array(z.string()).nullish(),
  dataPubblicazione: z.string().nullish(),
  categorie: z.array(z.string()).nullish(),
});
const pageSchema = z.object({ content: z.array(itemSchema), last: z.boolean() });
export type InpaItem = z.infer<typeof itemSchema>;

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const squash = (text: string) => text.split(/\s+/u).filter(Boolean).join(' ');

/**
 * A national competition has the single place "Nazionale", which no city filter accepts: it becomes `Italy`, the value
 * Indeed cards carry, which `filter.keepGenericItaly` lets through. Any other list of places is joined as it comes.
 */
export function placeOf(sedi: readonly string[] | null | undefined) {
  const places = (sedi ?? []).map(squash).filter(Boolean);
  return places.length === 1 && places[0]?.toLowerCase() === 'nazionale' ? 'Italy' : places.join(', ');
}

export function townOf(bodies: readonly string[] | null | undefined): string | undefined {
  if (bodies?.length !== 1 || !bodies[0]) return undefined;
  const body = squash(bodies[0]);
  if (/^unione\b/iu.test(body)) return body;
  const match = /^(?:comune (?:di |d'|del |della |dello |dei |degli )|città di )(.+)$/iu.exec(body);
  return match?.[1]?.replace(/\s*\([^()]+\)\s*$/u, '').trim() || undefined;
}

/** One item of the answer as a card. The short role name is the title; the long official title opens the text. */
export function readItem(item: InpaItem, cleaner: Document): Card {
  const role = squash(item.figuraRicercata ?? '');
  const official = squash(item.titolo);
  const description = cleanHtml(cleaner, `<p>${escapeText(official)}</p>${item.descrizione ?? ''}`);
  const posted = item.dataPubblicazione ? new Date(item.dataPubblicazione) : undefined;
  return {
    url: `${PUBLIC_PAGE}${encodeURIComponent(item.id)}`,
    title: role || official,
    company: (item.entiRiferimento ?? []).map(squash).filter(Boolean).join(', '),
    location: townOf(item.entiRiferimento) ?? placeOf(item.sedi),
    site: SITE,
    description: description.text,
    descriptionHtml: description.html,
    ...(posted && !Number.isNaN(posted.getTime()) ? { postedAt: posted } : {}),
  };
}

/** Milliseconds a `Retry-After` header asks for (seconds or an HTTP date); the default when it is absent or odd. */
export function retryAfter(header: string | null, now: number) {
  const value = header?.trim() ?? '';
  const ms = /^\d+$/u.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms >= 0 ? ms : DEFAULT_WAIT_MS;
}

export function createInpaSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  // One inert document for all cleaning: `cleanHtml` only creates detached elements in it.
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;

  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
    const { regionId, pageSize, maxPages } = context.limits.inpa;
    // One gate for every request, on the injected clock.
    let last = Number.NEGATIVE_INFINITY;

    async function post(page: number) {
      for (let attempt = 0; ; attempt++) {
        const delay = last + INTERVAL_MS - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        // Wall-clock on purpose: this guards a hung connection, it is not a pause the fake clock should drive.
        const timeout = AbortSignal.timeout(requestTimeoutMs);
        let response: Response;
        try {
          response = await fetchBounded(context.fetch, `${API}?page=${page}&size=${pageSize}`, {
            method: 'POST',
            headers: {
              accept: 'application/json',
              'accept-language': desktopHeaders['accept-language'],
              'content-type': 'application/json',
              'user-agent': desktopHeaders['user-agent'],
            },
            body: JSON.stringify({ text: '', categoriaId: null, regioneId: regionId, status: ['OPEN'] }),
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
          if (attempt >= RETRIES_AFTER_429 || wait > MAX_WAIT_MS) throw fail('HTTP 429');
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
          return pageSchema.parse(await readBoundedJson(response));
        } catch {
          if (context.signal.aborted) throw context.signal.reason;
          throw fail('unexpected answer');
        }
      }
    }

    const skipped = new Set((context.stable?.inpaSkipCategories ?? []).map(plain));
    const cards: Card[] = [];
    const seen = new Set<string>();
    // Set when the last page was read, not when the cap stopped the reading.
    let whole = false;
    try {
      // The cap, not the profile's `maxResultsPerQuery`, bounds the reading: a region holds a couple of hundred
      // competitions and a result cap meant for keyword searches would cut the list silently.
      for (let page = 0; page < maxPages && !context.signal.aborted; page++) {
        const body = await post(page);
        let added = 0;
        for (const item of body.content) {
          if (seen.has(item.id)) continue;
          seen.add(item.id);
          if ((item.categorie ?? []).some((category) => skipped.has(plain(category)))) continue;
          cards.push(readItem(item, cleaner));
          added++;
        }
        context.log.info({ page, cards: body.content.length, added }, 'inPA page done');
        if (body.last || body.content.length === 0) {
          whole = true;
          break;
        }
        if (page + 1 >= maxPages) context.log.warn({ maxPages }, 'inPA page cap reached before the last page');
      }
    } catch (error) {
      // A cancelled collection drops what this returns, so there is nothing to report.
      if (context.signal.aborted) return { cards };
      const safe = isOurs(error) ? error : fail('unexpected failure');
      context.log.warn(safe.message);
      return { cards, error: safe };
    }
    return { cards, complete: whole };
  }

  return { name: SITE, kind: 'list', search };
}
