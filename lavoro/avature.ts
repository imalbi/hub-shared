import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Card, SearchInput, SearchResult, Source, SourceContext } from './source.ts';

const fail = (message: string) => new Error(`avature: ${message}`);
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');
type Employer = { listUrl: string; company: string; country: string };
type Item = { id: string; title: string; location: string; country: string; url: string };
export function readPage(
  document: Document,
  employer: Employer,
): { items: Item[]; total: number | undefined; hasNext: boolean } {
  const items: Item[] = [];
  for (const heading of document.querySelectorAll('.article__header__text__title')) {
    const anchor = heading.querySelector('a[href]');
    const href = anchor?.getAttribute('href');
    if (!href || /qtvc/iu.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, employer.listUrl);
    } catch {
      continue;
    }
    const match = /\/JobDetail\/(?:[^/]+\/)?(\d+)\/?$/u.exec(url.pathname);
    if (!match || url.origin !== new URL(employer.listUrl).origin) continue;
    url.search = '';
    url.hash = '';
    const container = heading.parentElement;
    const location = squash(container?.querySelector('.article__header__text__subtitle--location')?.textContent);
    const country = squash(container?.querySelector('.job-info-icon_world')?.textContent);
    const title = squash(anchor?.textContent);
    if (title) items.push({ id: match[1] ?? '', title, location, country, url: url.href });
  }
  const totalMatch = /\b(\d+)\s+(?:risultat[oi]|results?)/iu.exec(squash(document.body?.textContent));
  const total = totalMatch ? Number(totalMatch[1]) : undefined;
  return { items, total, hasNext: document.querySelector('.paginationNextLink') !== null };
}

export function createAvatureSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  async function search(_input: SearchInput, context: SourceContext): Promise<SearchResult> {
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
          context.reportWait?.('avature', Math.ceil(wait / 1000));
          try {
            await context.sleep(wait);
          } finally {
            context.reportWait?.('avature', null);
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
    let firstError: Error | undefined;
    let capped = false;
    for (const employer of context.limits.avature.employers) {
      try {
        const found: Item[] = [];
        const seen = new Set<string>();
        let size = 0;
        let done = false;
        for (let page = 0; page < context.limits.avature.maxPages; page++) {
          const url = new URL(employer.listUrl);
          if (page) url.searchParams.set('jobOffset', String(page * size));
          const result = readPage(await get(url.href), employer);
          if (!result.items.length) {
            if (!page && result.total !== 0) throw fail('the search layout changed');
            if (page) context.log.warn('avature: later page has no postings');
            done = true;
            break;
          }
          if (!page) size = result.items.length;
          let added = 0;
          for (const item of result.items) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            added++;
            if (!employer.country || item.country === employer.country) found.push(item);
          }
          if (!added || !result.hasNext) {
            done = true;
            break;
          }
        }
        if (!done) capped = true;
        let failedDetails = 0;
        for (const item of found) {
          const card: Card = {
            site: 'avature',
            company: employer.company,
            url: item.url,
            title: item.title,
            location: item.location,
            description: [item.title, item.location, item.country].filter(Boolean).join(' | '),
          };
          if (context.isKnown(card.url)) {
            cards.push(card);
            continue;
          }
          try {
            const document = await get(card.url);
            // Labeled fields are metadata (Job ID, Country, City/Città...); the job text is usually in unlabeled ones,
            // falling back to labeled descriptive sections when unlabeled text is empty.
            let raw = '';
            let labeledRaw = '';
            let location = card.location;
            for (const field of document.querySelectorAll('.article--details .article__content__view__field')) {
              const label = squash(field.querySelector('.article__content__view__field__label')?.textContent);
              const value = field.querySelector('.article__content__view__field__value');
              if (!label) raw += value?.innerHTML ?? '';
              else if (/^(?:city|città|sede|location|work location)$/iu.test(label)) {
                const place = squash(value?.textContent);
                if (place) location = place;
              } else if (/descrizion|requisit|description|responsibilit|qualificat|attività|profilo/iu.test(label)) {
                labeledRaw += value?.innerHTML ?? '';
              }
            }
            let cleaned = cleanHtml(cleaner, raw);
            if (!cleaned.text && labeledRaw) cleaned = cleanHtml(cleaner, labeledRaw);
            if (!cleaned.text) throw fail('the detail layout changed');
            let postedAt: Date | undefined;
            for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
              try {
                const value: unknown = JSON.parse(script.textContent ?? '');
                if (
                  typeof value === 'object' &&
                  value !== null &&
                  'datePosted' in value &&
                  typeof value.datePosted === 'string' &&
                  /^\d{4}-\d{2}-\d{2}$/u.test(value.datePosted)
                ) {
                  const date = new Date(value.datePosted);
                  if (!Number.isNaN(date.getTime())) postedAt = date;
                }
              } catch {
                /* Other JSON-LD does not describe this posting. */
              }
            }
            cards.push({
              ...card,
              location,
              description: cleaned.text,
              descriptionHtml: cleaned.html,
              ...(postedAt ? { postedAt } : {}),
            });
          } catch (error) {
            if (context.signal.aborted) throw error;
            failedDetails++;
            cards.push({ ...card, detailsMissing: true });
          }
        }
        context.log.info({ company: employer.company, read: found.length, failedDetails }, 'Avature done');
      } catch (error) {
        if (context.signal.aborted) return { cards };
        const safe =
          error instanceof Error && error.message.startsWith('avature: ') ? error : fail('unexpected failure');
        firstError ??= safe;
        context.log.warn(safe.message);
      }
    }
    return { cards, ...(firstError ? { error: firstError } : {}), complete: !firstError && !capped };
  }
  return { name: 'avature', kind: 'list', search };
}
