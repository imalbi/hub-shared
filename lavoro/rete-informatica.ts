import { z } from '../../apps/server/src/core/module.ts';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';
import type { WorkMode } from './work-mode.ts';

// Rete Informatica Lavoro, an IT-only board of a few hundred postings: the listing is read by date once per collection
// and keywords are ignored, the profile's scoring does the selection. It follows the friend's working scraper
// (`reteinformaticalavoro()` in his `scrapers.py`): the detail page of every posting not already known is fetched
// inside the search, and its fields win over the card's. Errors carry a status, a fixed phrase or a count, never a
// body, a title or a URL.

const SITE = 'reteinformaticalavoro';
const BASE = 'https://reteinformaticalavoro.it';
const LIST = `${BASE}/offerte-di-lavoro`;
const PAGE_SIZE = 15;
// No rate limit observed by the friend: one request a second is enough not to hammer a small site.
const INTERVAL_MS = 1000;
const MODES: Record<string, WorkMode> = { totale: 'remote', parziale: 'hybrid' };
const JOB_ID = /\/lavoro\/(\d+)(?:[/?#]|$)/u;

const fail = (message: string) => new Error(`${SITE}: ${message}`);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');

/** The canonical posting URL: the slug varies, the id does not. Empty for a link that is not a posting. */
export function jobUrl(href: string) {
  const match = JOB_ID.exec(href);
  return match ? `${BASE}/lavoro/${match[1]}` : '';
}

/** `Milano (MI)` becomes `Milano, MI, Italia`; a foreign place (`Dublino`) stays as written. */
export function placeOf(text: string) {
  const place = squash(text);
  const match = /^(.+?)\s*\(([A-Z]{2})\)$/u.exec(place);
  return match ? `${match[1]}, ${match[2]}, Italia` : place;
}

const modeOf = (text: string): WorkMode | undefined => MODES[squash(text).toLowerCase()];

/** Local midnight of a `dd/mm/yy` or `dd/mm/yyyy` date, or of an ISO `yyyy-mm-dd` prefix. */
function dayOf(text: string) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/u.exec(text);
  const shown = /(\d{2})\/(\d{2})\/(\d{2}(?:\d{2})?)(?!\d)/u.exec(text);
  const [year, month, day] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : shown
      ? [Number(shown[3].length === 2 ? `20${shown[3]}` : shown[3]), Number(shown[2]), Number(shown[1])]
      : [];
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const isElement = (node: Node): node is Element => node.nodeType === 1;

/** The text of an element, leaving out the descendants that match `skip`. */
function textWithout(element: Element, skip: string): string {
  let text = '';
  for (const node of element.childNodes) {
    if (node.nodeType === 3) text += ` ${node.nodeValue ?? ''}`;
    else if (isElement(node) && !node.matches(skip)) text += ` ${textWithout(node, skip)}`;
  }
  return text;
}

/** One `article.ol-card` of the listing; undefined without an id, a title or a company. */
export function readCard(element: Element): Card | undefined {
  const url = jobUrl(element.querySelector('a.ol-card-link')?.getAttribute('href') ?? '');
  const titleElement = element.querySelector('.ol-title');
  const company = squash(element.querySelector('.ol-co')?.textContent);
  // The reference code (`.ol-code`) is not part of the title.
  const title = titleElement ? squash(textWithout(titleElement, '.ol-code')) : '';
  if (!url || !title || !company) return undefined;
  let location = '';
  let mode: WorkMode | undefined;
  for (const item of element.querySelectorAll('ul.ol-meta > li')) {
    const text = squash(item.textContent);
    if (item.querySelector('.fa-map-marker')) location = placeOf(text);
    else if (text.toLowerCase().startsWith('remote working:')) mode = modeOf(text.slice('remote working:'.length));
    // The other items are contract, seniority and pay: they have no column.
  }
  const postedAt = dayOf(squash(element.querySelector('.ol-data')?.textContent));
  return {
    url,
    title,
    company,
    location,
    site: SITE,
    ...(postedAt ? { postedAt } : {}),
    ...(mode ? { declaredMode: mode } : {}),
  };
}

const postingSchema = z.object({
  '@type': z.literal('JobPosting'),
  datePosted: z.string().optional().catch(undefined),
  hiringOrganization: z
    .object({ name: z.string().optional().catch(undefined) })
    .optional()
    .catch(undefined),
});

function readPosting(document: Document) {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const text = script.textContent ?? '';
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      // The site's JSON-LD sometimes has raw line breaks inside strings.
      try {
        const controlChars = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(0x1f)}]+`, 'gu');
        data = JSON.parse(text.replaceAll(controlChars, ' '));
      } catch {
        continue;
      }
    }
    const posting = postingSchema.safeParse(data);
    if (posting.success) return posting.data;
  }
  return undefined;
}

type Detail = Partial<
  Pick<Card, 'title' | 'company' | 'location' | 'postedAt' | 'declaredMode' | 'description' | 'descriptionHtml'>
>;

/** The fields of a posting page; a field the page does not carry is left out. */
export function readDetail(document: Document, cleaner: Document): Detail {
  const posting = readPosting(document);
  const title = squash(document.querySelector('h1.an-h1')?.textContent);
  const company =
    squash(document.querySelector('a.an-meta-co')?.textContent) || squash(posting?.hiringOrganization?.name);
  let location = '';
  // Among the class-less spans are the place and "Remote working"; the separators have `an-meta-sep`.
  for (const span of document.querySelector('.an-meta')?.children ?? []) {
    if (span.localName !== 'span' || span.hasAttribute('class')) continue;
    const text = squash(span.textContent);
    if (text && !text.toLowerCase().startsWith('remote working')) location = placeOf(text);
  }
  let mode: WorkMode | undefined;
  for (const row of document.querySelectorAll('dl.an-dl > div')) {
    const term = squash(row.querySelector('dt')?.textContent).toLowerCase();
    if (term === 'remote working') mode = modeOf(row.querySelector('dd')?.textContent ?? '');
  }
  const postedAt = dayOf(posting?.datePosted ?? '') ?? dayOf(squash(document.querySelector('.an-data')?.textContent));
  const body = document.querySelector('div.an-testo');
  const description = body ? cleanHtml(cleaner, body.innerHTML) : undefined;
  return {
    ...(title ? { title } : {}),
    ...(company ? { company } : {}),
    ...(location ? { location } : {}),
    ...(mode ? { declaredMode: mode } : {}),
    ...(postedAt ? { postedAt } : {}),
    ...(description?.text ? { description: description.text, descriptionHtml: description.html } : {}),
  };
}

export function createReteInformaticaSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  // One inert document for all cleaning: `cleanHtml` only creates detached elements in it.
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;

  async function search(input: SearchInput, context: SourceContext): Promise<SearchResult> {
    // One gate for listing and details together, on the injected clock.
    let last = Number.NEGATIVE_INFINITY;
    async function get(url: string) {
      const delay = last + INTERVAL_MS - context.now();
      if (delay > 0) await context.sleep(delay);
      if (context.signal.aborted) throw context.signal.reason;
      // Wall-clock on purpose: this guards a hung connection, it is not a pause the fake clock should drive.
      const timeout = AbortSignal.timeout(requestTimeoutMs);
      try {
        const response = await fetchBounded(context.fetch, url, {
          headers: desktopHeaders,
          signal: AbortSignal.any([context.signal, timeout]),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw fail(`HTTP ${response.status}`);
        }
        return parseHTML(await readBoundedText(response)).document;
      } catch (error) {
        if (context.signal.aborted || (error instanceof Error && error.message.startsWith(`${SITE}: `))) throw error;
        throw fail(
          timeout.aborted ? 'request timed out' : `request failed (${error instanceof Error ? error.name : 'unknown'})`,
        );
      } finally {
        last = context.now();
      }
    }

    const cards: Card[] = [];
    const seen = new Set<string>();
    const cutoff = new Date(context.now() - input.hoursOld * 3_600_000);
    cutoff.setHours(0, 0, 0, 0);
    let knownPages = 0;
    try {
      for (let page = 1; cards.length < input.maxResults && !context.signal.aborted; page++) {
        const listing = await get(page === 1 ? LIST : `${LIST}?page=${page}`);
        const elements = [...listing.querySelectorAll('article.ol-card')];
        if (elements.length === 0) break;
        const read = elements.flatMap((element) => readCard(element) ?? []);
        // Cards that all fail to read mean the page moved: say so, instead of looking like a quiet day.
        if (read.length === 0) throw fail(`none of the ${elements.length} cards could be read`);
        let added = 0;
        let fresh = 0;
        let failedDetails = 0;
        let older = false;
        for (const card of read) {
          if (seen.has(card.url)) continue;
          if (card.postedAt && card.postedAt < cutoff) {
            older = true;
            continue;
          }
          seen.add(card.url);
          added++;
          let complete = card;
          if (!context.isKnown(card.url)) {
            fresh++;
            try {
              const detail = readDetail(await get(card.url), cleaner);
              // The detail wins; a field it omits (a place, say) keeps the card's. No text is a missing detail, as for
              // an empty `describe`: retried next time rather than judged on the title.
              complete = { ...card, ...detail, ...(detail.description ? {} : { detailsMissing: true }) };
              if (!detail.description) failedDetails++;
            } catch (error) {
              if (context.signal.aborted) throw error;
              // Not remembered as judged: the next collection tries the page again.
              complete = { ...card, detailsMissing: true };
              failedDetails++;
            }
          }
          cards.push(complete);
          if (cards.length >= input.maxResults) break;
        }
        context.log.info({ page, cards: read.length, added, fresh, failedDetails }, 'Rete Informatica page done');
        // Only repeats of this search's own cards: a page number past the end that serves an earlier page again.
        if (older || added === 0) break;
        knownPages = fresh > 0 ? 0 : knownPages + 1;
        if (input.knownPagesToStop > 0 && knownPages >= input.knownPagesToStop) break;
        if (elements.length < PAGE_SIZE) break;
      }
    } catch (error) {
      // A cancelled collection drops what this returns, so there is nothing to report.
      if (context.signal.aborted) return { cards };
      const safe = error instanceof Error && error.message.startsWith(`${SITE}: `) ? error : fail('unexpected failure');
      context.log.warn(safe.message);
      return { cards, error: safe };
    }
    return { cards };
  }

  return { name: SITE, kind: 'list', search };
}
