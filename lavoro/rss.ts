import { DOMParser, parseHTML } from 'linkedom';
import { cleanHtml } from './clean-html.ts';
import { publicSourceUrl, sourceRequest } from './source-request.ts';
import type { Card, SearchResult, Source } from './source.ts';

export function readFeed(xml: string, feed: { url: string; company: string }): Card[] {
  const document = new DOMParser().parseFromString(xml, 'text/xml');
  const root = document.documentElement;
  const atom = root?.localName === 'feed';
  if (!root || (!atom && root.localName !== 'rss')) throw new Error('rss: the feed layout changed');
  if (!atom && !root.querySelector('channel')) throw new Error('rss: the feed layout changed');
  // linkedom repairs truncated XML; a missing root close must never authorize archival.
  const closed = atom ? /<\/feed\s*>\s*$/u : /<\/rss\s*>\s*$/u;
  if (!closed.test(xml.trim())) throw new Error('rss: the feed layout changed');
  const cleaner = parseHTML('<html><body></body></html>').document;
  const entries = [...root.querySelectorAll(atom ? 'entry' : 'item')];
  return entries.map((entry) => {
    const title = entry.querySelector('title')?.textContent?.trim();
    const link = atom
      ? [...entry.querySelectorAll('link')]
          .find((element) => !element.getAttribute('rel') || element.getAttribute('rel') === 'alternate')
          ?.getAttribute('href')
      : entry.querySelector('link')?.textContent;
    if (!title || !link) throw new Error('rss: invalid feed entry');
    const content = entry.querySelector(atom ? 'content' : 'description') ?? entry.querySelector('summary');
    const raw = content?.getAttribute('type') === 'xhtml' ? content.innerHTML : (content?.textContent ?? '');
    const cleaned = cleanHtml(cleaner, raw);
    const date = new Date(entry.querySelector(atom ? 'published, updated' : 'pubDate')?.textContent ?? '');
    return {
      url: publicSourceUrl(link.trim(), feed.url),
      title,
      company: feed.company,
      location: entry.querySelector('location, coverage')?.textContent?.trim() ?? '',
      site: 'rss',
      ...(cleaned.text ? { description: cleaned.text, descriptionHtml: cleaned.html } : { detailsMissing: true }),
      ...(!Number.isNaN(date.getTime()) ? { postedAt: date } : {}),
    };
  });
}

export function createRssSource(): Source {
  return {
    name: 'rss',
    kind: 'list',
    async search(_input, context): Promise<SearchResult> {
      const settings = context.limits.rss;
      if (!settings) throw new Error('search.rss is required');
      const request = sourceRequest('rss', context);
      const cards: Card[] = [];
      let error: Error | undefined;
      let capped = false;
      const seen = new Set<string>();
      for (const feed of settings.feeds) {
        try {
          const items = readFeed(await request(feed.url), feed);
          if (items.length > settings.maxItems) capped = true;
          for (const card of items.slice(0, settings.maxItems)) {
            if (seen.has(card.url)) continue;
            seen.add(card.url);
            cards.push(card);
          }
        } catch (caught) {
          if (context.signal.aborted) return { cards };
          const current =
            caught instanceof Error && caught.message.startsWith('rss: ') ? caught : new Error('rss: invalid feed');
          error ??= current;
          context.log.warn(current.message);
        }
      }
      return { cards, complete: !error && !capped, ...(error ? { error } : {}) };
    },
  };
}
