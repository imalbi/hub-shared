import { parseHTML } from 'linkedom';
import { cleanHtml } from './clean-html.ts';
import { publicSourceUrl, sourceRequest } from './source-request.ts';
import type { Card, SearchResult, Source } from './source.ts';

export function readAltamira(document: Document, listUrl: string, company: string): { cards: Card[]; next?: string } {
  const table = document.querySelector('td[data-title="Titolo"]')?.closest('table');
  if (!table) throw new Error('altamira: the listing layout changed');
  const cards = [...table.querySelectorAll('tr.GRID_DAT_ROW')].map((row): Card => {
    const link = row.querySelector('td[data-title="Titolo"] a[href]');
    const title = link?.textContent?.trim();
    const href = link?.getAttribute('href');
    if (!title || !href) throw new Error('altamira: invalid listing entry');
    const url = publicSourceUrl(href, listUrl);
    if (new URL(url).origin !== new URL(listUrl).origin || !new URL(url).pathname.startsWith('/annunci-lavoro/'))
      throw new Error('altamira: invalid posting URL');
    const dateText = row.querySelector('td[data-title="Data di pubblicazione"]')?.textContent?.trim() ?? '';
    const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(dateText);
    const date = parts ? new Date(`${parts[3]}-${parts[2]}-${parts[1]}T00:00:00Z`) : new Date('');
    return {
      url,
      title,
      company,
      site: 'altamira',
      location: row.querySelector('td[data-title="Sedi"]')?.textContent?.trim() ?? '',
      ...(!Number.isNaN(date.getTime()) ? { postedAt: date } : {}),
    };
  });
  const nextLink = document.querySelector('a[rel="next"]');
  const href = nextLink?.getAttribute('href');
  let next: string | undefined;
  if (href) {
    next = publicSourceUrl(href, listUrl);
    if (new URL(next).origin !== new URL(listUrl).origin) throw new Error('altamira: invalid next page');
  }
  // shortcut: only public link pagination is supported; fail closed on ASP.NET postback paging.
  if (!next && document.querySelector('[onclick*="Page$"]')) throw new Error('altamira: unsupported pagination');
  return { cards, ...(next ? { next } : {}) };
}

export function createAltamiraSource(): Source {
  return {
    name: 'altamira',
    kind: 'list',
    async search(_input, context): Promise<SearchResult> {
      const settings = context.limits.altamira;
      if (!settings) throw new Error('search.altamira is required');
      const request = sourceRequest('altamira', context);
      const cleaner = parseHTML('<html><body></body></html>').document;
      const cards: Card[] = [];
      const seen = new Set<string>();
      let error: Error | undefined;
      let capped = false;
      for (const employer of settings.employers) {
        try {
          let url: string | undefined = employer.listUrl;
          const pages = new Set<string>();
          for (let page = 0; url && page < settings.maxPages; page++) {
            if (pages.has(url)) throw new Error('altamira: repeated listing page');
            pages.add(url);
            const result = readAltamira(parseHTML(await request(url)).document, url, employer.company);
            for (const card of result.cards) {
              if (seen.has(card.url)) continue;
              seen.add(card.url);
              if (context.isKnown(card.url)) {
                cards.push(card);
                continue;
              }
              try {
                const detail = parseHTML(await request(card.url)).document.querySelector(
                  'section.job-detail [data-title="Testo"] .LABLE',
                );
                const cleaned = cleanHtml(cleaner, detail?.innerHTML ?? '');
                cards.push({
                  ...card,
                  ...(cleaned.text
                    ? { description: cleaned.text, descriptionHtml: cleaned.html }
                    : { detailsMissing: true }),
                });
              } catch (caught) {
                if (context.signal.aborted) throw caught;
                cards.push({ ...card, detailsMissing: true });
              }
            }
            url = result.next;
          }
          if (url) capped = true;
        } catch (caught) {
          if (context.signal.aborted) return { cards };
          const current =
            caught instanceof Error && caught.message.startsWith('altamira: ')
              ? caught
              : new Error('altamira: invalid listing');
          error ??= current;
          context.log.warn(current.message);
        }
      }
      return { cards, complete: !error && !capped, ...(error ? { error } : {}) };
    },
  };
}
