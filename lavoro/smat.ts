import { parseHTML } from 'linkedom';
import { cleanHtml } from './clean-html.ts';
import { publicSourceUrl, sourceRequest } from './source-request.ts';
import type { Card, SearchResult, Source } from './source.ts';

export function readSmat(document: Document, baseUrl: string, company: string): Card[] {
  const tables = [...document.querySelectorAll('.page-text table')];
  if (!tables.length) throw new Error('smat: the listing layout changed');
  const cleaner = parseHTML('<html><body></body></html>').document;
  const cards: Card[] = [];
  let notices = 0;
  for (const table of tables) {
    for (const row of table.querySelectorAll('tbody > tr')) {
      const cells = [...row.querySelectorAll(':scope > td')];
      const link = [...row.querySelectorAll('a[href]')].find((element) =>
        /AVVISO DI SELEZIONE/iu.test(element.textContent ?? ''),
      );
      if (!link) continue;
      notices++;
      if (/\b(?:CHIUSA|CHIUSO|SCADUTA|SCADUTO|ARCHIVIATA)\b/iu.test(cells.at(-1)?.textContent ?? '')) continue;
      const href = link.getAttribute('href');
      const cleaned = cleanHtml(cleaner, cells[0]?.innerHTML ?? '');
      if (!href || !cleaned.text) throw new Error('smat: invalid notice');
      const url = publicSourceUrl(href, baseUrl);
      if (new URL(url).origin !== new URL(baseUrl).origin) throw new Error('smat: invalid notice URL');
      // shortcut: PDF qualifications stay incomplete until a generic notice/PDF reader is available.
      cards.push({
        url,
        title: cleaned.text.split('\n').join(' '),
        company,
        site: 'smat',
        location: /Sede di lavoro:\s*([^\n]+)/iu.exec(cleaned.text)?.[1]?.trim() ?? '',
        description: cleaned.text,
        descriptionHtml: cleaned.html,
        detailsMissing: true,
      });
    }
  }
  if (!notices) throw new Error('smat: the listing layout changed');
  return cards;
}

export function createSmatSource(): Source {
  return {
    name: 'smat',
    kind: 'list',
    async search(_input, context): Promise<SearchResult> {
      const settings = context.limits.smat;
      if (!settings) throw new Error('search.smat is required');
      try {
        const request = sourceRequest('smat', context);
        const document = parseHTML(await request(settings.baseUrl)).document;
        // The observed board is one archive page; do not claim completeness for a new paginated layout.
        if (document.querySelector('a[rel="next"]')) throw new Error('smat: unsupported pagination');
        return { cards: readSmat(document, settings.baseUrl, settings.company), complete: true };
      } catch (caught) {
        if (context.signal.aborted) return { cards: [] };
        const error =
          caught instanceof Error && caught.message.startsWith('smat: ') ? caught : new Error('smat: invalid listing');
        context.log.warn(error.message);
        return { cards: [], complete: false, error };
      }
    },
  };
}
