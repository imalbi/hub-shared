import type { Card, SearchInput, Source, SourceContext } from './source.ts';

// A deterministic source for tests, from invented data only. It reads cards from a `catalog` function, waits on the
// injected clock, can fail after N cards, pages like a real listing (stopping on known pages) and describes cards.

export type FakeSourceOptions = {
  name?: string;
  kind?: 'search' | 'list';
  /** The cards the site holds for a search, in listing order. */
  catalog?: (input: SearchInput) => Card[];
  /** Virtual milliseconds one search takes. */
  delayMs?: number;
  /** The search returns this many cards, then an error. */
  failAfter?: number;
  pageSize?: number;
  /** Without it the source has no `describe`, like one whose listing already carries the text. */
  describe?: (card: Card) => string | Error;
  /** Virtual milliseconds one description takes. */
  describeDelayMs?: number;
};

export function makeCard(site: string, index: number, patch: Partial<Card> = {}): Card {
  return {
    url: `https://${site}.example/jobs/${index}`,
    title: `Frontend developer ${index}`,
    company: `Company ${index}`,
    location: 'Exampleville',
    site,
    ...patch,
  };
}

export function createFakeSource(options: FakeSourceOptions = {}) {
  const { name = 'indeed', kind = 'search', delayMs = 0, failAfter, pageSize = 10 } = options;
  const catalog = options.catalog ?? (() => [0, 1, 2].map((index) => makeCard(name, index)));
  const record = {
    searches: [] as SearchInput[],
    starts: [] as number[],
    described: [] as string[],
    pages: 0,
    active: 0,
    maxActive: 0,
  };

  async function search(input: SearchInput, context: SourceContext) {
    record.searches.push(input);
    record.starts.push(context.now());
    record.maxActive = Math.max(record.maxActive, ++record.active);
    try {
      if (delayMs) await context.sleep(delayMs);
      const cards: Card[] = [];
      let knownPages = 0;
      const all = catalog(input).slice(0, input.maxResults);
      for (let from = 0; from < all.length && !context.signal.aborted; from += pageSize) {
        const page = all.slice(from, from + pageSize);
        record.pages++;
        for (const card of page) {
          if (failAfter !== undefined && cards.length === failAfter)
            return { cards, error: new Error('the fake site broke off') };
          cards.push(card);
        }
        knownPages = page.every((card) => context.isKnown(card.url)) ? knownPages + 1 : 0;
        if (input.knownPagesToStop > 0 && knownPages >= input.knownPagesToStop) break;
      }
      return { cards };
    } finally {
      record.active--;
    }
  }

  const source: Source = {
    name,
    kind,
    search,
    ...(options.describe && {
      describe: async (card: Card, context: SourceContext) => {
        record.described.push(card.url);
        if (options.describeDelayMs) await context.sleep(options.describeDelayMs);
        const text = options.describe?.(card);
        if (text instanceof Error) throw text;
        return text ?? '';
      },
    }),
  };
  return Object.assign(source, { record });
}
