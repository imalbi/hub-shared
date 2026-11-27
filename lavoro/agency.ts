import { parseHTML } from 'linkedom';
import { z } from '../../apps/server/src/core/module.ts';
import { cleanHtml } from './clean-html.ts';
import { publicSourceUrl, sourceRequest } from './source-request.ts';
import type { Card, SearchResult, SourceContext } from './source.ts';

export type AgencyCard = Card & { contract?: string; salary?: string; detailUrl?: string };
export type AgencyRequest = { url: string; init?: RequestInit & { body?: string } };
export type AgencyPage = { cards: AgencyCard[]; next?: AgencyRequest };

export function agencyDescription(contract: string | undefined, salary: string | undefined, html: string) {
  const document = parseHTML('<html><body></body></html>').document;
  const header = document.createElement('p');
  header.textContent = `Contratto: ${contract?.trim() || 'Non indicato'}${salary?.trim() ? ` · Retribuzione: ${salary.trim()}` : ''}`;
  const cleaned = cleanHtml(document, header.outerHTML + html);
  return { description: cleaned.text, descriptionHtml: cleaned.html };
}

export function agencyUrl(value: string, base: string, prefix: string) {
  const url = publicSourceUrl(value, base);
  if (new URL(url).origin !== new URL(base).origin || !new URL(url).pathname.startsWith(prefix))
    throw new Error('invalid agency link');
  return url;
}

export function agencyDate(value: string | undefined): Date | undefined {
  if (!value) return;
  const parts = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(value);
  const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}T00:00:00Z` : value;
  const date = new Date(iso);
  if (!Number.isNaN(date.getTime())) return date;
}

const posting = z.object({
  '@type': z.literal('JobPosting'),
  description: z.string(),
  datePosted: z.string().optional(),
});
export function agencyJsonDetail(card: AgencyCard, raw: string): AgencyCard {
  const document = parseHTML(raw).document;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let value: unknown;
    try {
      value = JSON.parse(script.textContent ?? '');
    } catch {
      continue;
    }
    const result = posting.safeParse(value);
    if (!result.success) continue;
    const date = agencyDate(result.data.datePosted);
    return { ...card, descriptionHtml: result.data.description, ...(date ? { postedAt: date } : {}) };
  }
  throw new Error('missing agency detail');
}

/** Agencies share the same detail fallback, URL cache, pacing and per-scope failure rules. */
export async function collectAgency(
  site: string,
  scopes: AgencyRequest[],
  maxPages: number,
  context: SourceContext,
  read: (raw: string, current: AgencyRequest) => AgencyPage,
  detail: (card: AgencyCard, raw: string) => AgencyCard,
): Promise<SearchResult> {
  const request = sourceRequest(site, context);
  const cards: Card[] = [];
  const seen = new Set<string>();
  let error: Error | undefined;
  let capped = false;
  for (const scope of scopes) {
    try {
      let current: AgencyRequest | undefined = scope;
      const pages = new Set<string>();
      for (let page = 0; current && page < maxPages; page++) {
        const key = current.url + (current.init?.body ?? '');
        if (pages.has(key)) throw new Error('repeated listing page');
        pages.add(key);
        const result = read(await request(current.url, current.init), current);
        for (const card of result.cards) {
          if (seen.has(card.url)) continue;
          seen.add(card.url);
          let enriched = card;
          if (!context.isKnown(card.url)) {
            try {
              enriched = detail(card, await request(card.detailUrl ?? card.url));
              const cleaned = cleanHtml(parseHTML('<html></html>').document, enriched.descriptionHtml ?? '');
              if (!cleaned.text) throw new Error('empty agency detail');
            } catch (caught) {
              if (context.signal.aborted) throw caught;
              enriched = { ...card, detailsMissing: true };
            }
          }
          const { contract, salary, detailUrl: _detailUrl, ...posting } = enriched;
          cards.push({ ...posting, ...agencyDescription(contract, salary, enriched.descriptionHtml ?? '') });
        }
        current = result.next;
      }
      if (current) capped = true;
    } catch (caught) {
      if (context.signal.aborted) return { cards };
      const current =
        caught instanceof Error && new RegExp(`^${site}: (HTTP \\d{3}|request failed)$`, 'u').test(caught.message)
          ? caught
          : new Error(`${site}: invalid listing`);
      error ??= current;
      context.log.warn(current.message);
    }
  }
  return { cards, complete: !error && !capped, ...(error ? { error } : {}) };
}
