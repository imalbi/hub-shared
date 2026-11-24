import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { fetchBounded, readBoundedText } from './bounded-fetch.ts';
import { cleanHtml } from './clean-html.ts';
import { desktopHeaders } from './desktop-headers.ts';
import { retryAfter } from './inpa.ts';
import type { Card, Source } from './source.ts';

const origin = 'https://www.manpower.it';
const squash = (text: string | null | undefined) => (text ?? '').split(/\s+/u).filter(Boolean).join(' ');
type Item = {
  id: string;
  title: string;
  location: string;
  contract: string;
  salary: string;
  postedAt?: Date;
  url: string;
};

export function readPage(document: Document, page: number): { items: Item[]; hasNext: boolean } {
  const items: Item[] = [];
  for (const body of document.querySelectorAll('.card-body')) {
    const anchor = body.querySelector('.title a[href]');
    const href = anchor?.getAttribute('href');
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, origin);
    } catch {
      continue;
    }
    const match = /^\/it\/annuncio-lavoro\/(?:[^/]+\/)+([0-9]+)\/?$/u.exec(url.pathname);
    if (!match || url.origin !== origin) continue;
    url.search = '';
    url.hash = '';
    const title = squash(anchor?.textContent);
    if (!title) continue;
    const date = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(squash(body.querySelector('.date')?.textContent));
    const postedAt = date ? new Date(Number(date[3]), Number(date[2]) - 1, Number(date[1])) : undefined;
    items.push({
      id: match[1] ?? '',
      title,
      location: squash(body.querySelector('.location')?.textContent),
      contract: squash(body.querySelector('.type')?.textContent),
      salary: squash(body.querySelector('.salary')?.textContent),
      ...(postedAt && !Number.isNaN(postedAt.getTime()) ? { postedAt } : {}),
      url: url.href,
    });
  }
  const hasNext = [...document.querySelectorAll('a[href]')].some((a) =>
    a.getAttribute('href')?.endsWith(`/p${page + 1}`),
  );
  return { items, hasNext };
}

export function createManpowerSource({ requestTimeoutMs = 20_000 }: { requestTimeoutMs?: number } = {}): Source {
  const cleaner = parseHTML('<html><body></body></html>').document;
  return {
    name: 'manpower',
    kind: 'list',
    async search(_input, context) {
      const cards: Card[] = [];
      let last = Number.NEGATIVE_INFINITY;
      async function get(url: string): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
          const delay = last + 1000 - context.now();
          if (delay > 0) await context.sleep(delay);
          if (context.signal.aborted) throw context.signal.reason;
          let response: Response;
          try {
            response = await fetchBounded(context.fetch, url, {
              headers: desktopHeaders,
              signal: AbortSignal.any([context.signal, AbortSignal.timeout(requestTimeoutMs)]),
            });
          } finally {
            last = context.now();
          }
          if (response.status !== 429) return response;
          await response.body?.cancel();
          const wait = retryAfter(response.headers.get('retry-after'), context.now());
          if (attempt >= 2 || wait > 120_000) return response;
          context.reportWait?.('manpower', Math.ceil(wait / 1000));
          try {
            await context.sleep(wait);
          } finally {
            context.reportWait?.('manpower', null);
          }
        }
      }
      const settings = context.limits.manpower;
      let capped = false;
      let firstError: Error | undefined;
      const seen = new Set<string>();
      for (const slug of settings.functions) {
        try {
          const url = `${origin}/it/trova-lavoro/citta/${settings.city}/funzioni/${slug}`;
          for (let page = 1; page <= settings.maxPages; page++) {
            const response = await get(page === 1 ? url : `${url}/p${page}`);
            if (!response.ok) {
              await response.body?.cancel();
              throw new Error(`manpower: function ${slug} HTTP ${response.status}`);
            }
            const listing = parseHTML(await readBoundedText(response)).document;
            const result = readPage(listing, page);
            let added = 0;
            for (const item of result.items) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              added++;
              const first = `Contratto: ${item.contract}${item.salary ? ` · Retribuzione: ${item.salary}` : ''}`;
              const card: Card = {
                site: 'manpower',
                company: 'Manpower',
                url: item.url,
                title: item.title,
                location: item.location,
                ...(item.postedAt ? { postedAt: item.postedAt } : {}),
                description: first,
              };
              if (context.isKnown(item.url)) {
                cards.push(card);
                continue;
              }
              try {
                const response = await get(item.url);
                if (!response.ok) {
                  await response.body?.cancel();
                  throw new Error('detail failed');
                }
                const document = parseHTML(await readBoundedText(response)).document;
                // outerHTML keeps each metadata field a block of its own, so "Tempo indeterminato" is not glued
                // to the next field; the posting text is in details-rich-text, not in the field list.
                const raw = [...document.querySelectorAll('.job-details-list .job-details-text, .details-rich-text')]
                  .map((block) => block.outerHTML)
                  .join('');
                const cleaned = cleanHtml(cleaner, raw);
                if (!cleaned.text) throw new Error('detail failed');
                const firstHtml = cleaner.createElement('p');
                firstHtml.textContent = first;
                cards.push({
                  ...card,
                  description: `${first}\n${cleaned.text}`,
                  descriptionHtml: `${firstHtml.outerHTML}${cleaned.html}`,
                });
              } catch (error) {
                if (context.signal.aborted) throw error;
                cards.push({ ...card, detailsMissing: true });
              }
            }
            if (!added || !result.hasNext) break;
            if (page === settings.maxPages) capped = true;
          }
        } catch (error) {
          if (context.signal.aborted) return { cards };
          const safe =
            error instanceof Error && error.message.startsWith(`manpower: function ${slug} HTTP `)
              ? error
              : new Error(`manpower: function ${slug} request failed`);
          firstError ??= safe;
          context.log.warn(safe.message);
        }
      }
      return { cards, ...(firstError ? { error: firstError } : {}), complete: !capped && !firstError };
    },
  };
}
