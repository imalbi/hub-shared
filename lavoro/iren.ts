import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

// IRENfutura, Iren's own job board (16n3a): plain server-rendered HTML, no API and no login. The board lists every
// open posting once, each in a `div.element` whose `data-category` is the region code; the detail page adds the deadline,
// the long text and the study requirements. Every posting is Stabile through `stable.sites`. Errors carry a status or a
// fixed phrase, never a body, a title or a URL.

const SITE = 'iren';
const PAGE = 'https://irenfutura.gruppoiren.it/irenlavoraconnoi/Default.aspx';
const BOARD_URL = `${PAGE}?tabid=188`;
const INTERVAL_MS = 1000;
const RETRIES_AFTER_429 = 2;
const MAX_WAIT_MS = 120_000;

const fail = (message: string) => new Error(`${SITE}: ${message}`);
const isOurs = (error: unknown): error is Error => error instanceof Error && error.message.startsWith(`${SITE}: `);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');
const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export type IrenItem = {
  region: string;
  id: string;
  title: string;
  town?: string;
  abstract: string;
  agency?: string;
};

function idOf(href: string) {
  const raw = /[?&]jobid=([^&#]+)/iu.exec(href)?.[1] ?? '';
  try {
    return squash(decodeURIComponent(raw));
  } catch {
    return squash(raw);
  }
}

/** One `div.element` of the board; undefined without a posting link, an id or a title. */
export function readItem(element: Element): IrenItem | undefined {
  const id = idOf(element.querySelector('a[href*="jobid="]')?.getAttribute('href') ?? '');
  const shown = squash(element.querySelector('h4')?.textContent);
  const split = /^(.*?)\s*\(([^()]+)\)$/u.exec(shown);
  const title = split ? squash(split[1]) : shown;
  const town = squash(split?.[2]);
  if (!id || !title) return undefined;
  const agency = squash(element.querySelector('small b')?.textContent);
  return {
    region: element.getAttribute('data-category') ?? '',
    id,
    title,
    abstract: squash(element.querySelector('i small')?.textContent),
    ...(town ? { town } : {}),
    ...(agency ? { agency } : {}),
  };
}

/** The readable items and how many elements the board has: zero elements means the layout changed. */
export function readBoard(document: Document) {
  const elements = [...document.querySelectorAll('div.element[data-category]')];
  return { total: elements.length, items: elements.flatMap((element) => readItem(element) ?? []) };
}

const detailLink = (id: string) => `${PAGE}?tabid=201&jobid=${encodeURIComponent(id)}`;

function plainCard(item: IrenItem, cleaner: Document, location: string): Card {
  const text = cleanHtml(cleaner, item.abstract ? `<p>${escapeText(item.abstract)}</p>` : '');
  return {
    url: detailLink(item.id),
    title: item.title,
    company: item.agency ? `Iren tramite ${item.agency}` : 'Iren',
    location: item.town ?? location,
    site: SITE,
    ...(text.text ? { description: text.text, descriptionHtml: text.html } : {}),
  };
}

/** The lines of a long field as paragraphs, from its markup: the page breaks lines with raw newlines. */
const paragraphs = (markup: string) =>
  markup
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('');

const short = (label: string, value: string) => (value ? `<p>${escapeText(`${label}: ${value}`)}</p>` : '');

/** The text of a posting page: deadline, abstract, description and study requirements. Empty when the form is absent. */
export function readDetail(document: Document, cleaner: Document): Pick<Card, 'description' | 'descriptionHtml'> {
  const fields = new Map<string, Element | null>();
  for (const row of document.querySelectorAll('.xmp-form-row')) {
    const label = squash(row.querySelector('i')?.textContent).replace(/:$/u, '').toLowerCase();
    fields.set(label, row.querySelector('h3'));
  }
  const plain = (label: string) => squash(fields.get(label)?.textContent);
  const long = (label: string) => paragraphs(fields.get(label)?.innerHTML ?? '');
  const markup = [
    short('Scadenza', plain('data scadenza')),
    long('abstract'),
    long('descrizione'),
    short('Livello di studio', plain('livello di studio')),
    short('Titolo di studio richiesto', plain('titolo di studio richiesto')),
  ].join('');
  const cleaned = cleanHtml(cleaner, markup);
  return cleaned.text ? { description: cleaned.text, descriptionHtml: cleaned.html } : {};
}

export function createIrenSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  // One inert document for all cleaning: `cleanHtml` only creates detached elements in it.
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;

  async function search(input: SearchInput, context: SourceContext): Promise<SearchResult> {
    const regions = new Set(context.limits.iren.regions);
    // One gate for the board and the details together, on the injected clock.
    let last = Number.NEGATIVE_INFINITY;

    async function get(url: string) {
      for (let attempt = 0; ; attempt++) {
        const delay = last + INTERVAL_MS - context.now();
        if (delay > 0) await context.sleep(delay);
        if (context.signal.aborted) throw context.signal.reason;
        // Wall-clock on purpose: this guards a hung connection, it is not a pause the fake clock should drive.
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
          return parseHTML(await readBoundedText(response)).document;
        } catch {
          if (context.signal.aborted) throw context.signal.reason;
          throw fail('request failed');
        }
      }
    }

    const cards: Card[] = [];
    try {
      const { items, total } = readBoard(await get(BOARD_URL));
      // An empty region on a live board is possible; a board with no postings at all is a moved layout.
      if (total === 0) throw fail('the board layout changed');
      const seen = new Set<string>();
      let fresh = 0;
      let failedDetails = 0;
      for (const item of items) {
        if (!regions.has(item.region) || seen.has(item.id)) continue;
        seen.add(item.id);
        const card = plainCard(item, cleaner, input.location);
        if (context.isKnown(card.url)) {
          cards.push(card);
          continue;
        }
        fresh++;
        try {
          const detail = readDetail(await get(card.url), cleaner);
          // No text is a missing detail: the card keeps the abstract and is judged again next time.
          if (!detail.description) failedDetails++;
          cards.push({ ...card, ...detail, ...(detail.description ? {} : { detailsMissing: true }) });
        } catch (error) {
          if (context.signal.aborted) throw error;
          failedDetails++;
          cards.push({ ...card, detailsMissing: true });
        }
      }
      context.log.info(
        { board: total, read: items.length, cards: cards.length, fresh, failedDetails },
        'IRENfutura done',
      );
    } catch (error) {
      // A cancelled collection drops what this returns, so there is nothing to report.
      if (context.signal.aborted) return { cards };
      const safe = isOurs(error) ? error : fail('unexpected failure');
      context.log.warn(safe.message);
      return { cards, error: safe };
    }
    return { cards, complete: true };
  }

  return { name: SITE, kind: 'list', search };
}
