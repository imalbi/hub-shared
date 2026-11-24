import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { detail, host, html, table, tiles, url } from './fake-successfactors.ts';
import { silentLog, testProfile } from './harness.ts';
import { createSuccessFactorsSource, readDetail, readPage } from './successfactors.ts';
import type { SearchInput, SourceContext } from './source.ts';

const doc = (s: string) => parseHTML(`<html><body>${s}</body></html>`).document;
const input: SearchInput = {
  query: { name: 'Web', keywords: '', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};
function context(fetch: typeof globalThis.fetch, options: object = {}, known = false) {
  const profile = testProfile((p) =>
    Object.assign(p.search, {
      successfactors: {
        employers: [{ host, company: 'Configured employer' }],
        places: ['Torino'],
        maxPages: 10,
        ...options,
      },
    }),
  );
  let now = 0;
  const value: SourceContext = {
    signal: new AbortController().signal,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    log: silentLog,
    isKnown: () => known,
    limits: profile.search,
    sources: profile.sources,
  };
  return value;
}
void test('table page returns ids, clean URLs, titles, places, total and page size', () => {
  assert.deepEqual(readPage(doc(table(0, 3, [1, 2])), host), {
    items: [
      { id: '1', url: url(1), title: 'Addetto esempio 1', location: 'Torino' },
      { id: '2', url: url(2), title: 'Addetto esempio 2', location: 'Torino' },
    ],
    total: 3,
    pageSize: 2,
  });
});
void test('tile page takes precedence over an embedded table', () => {
  assert.deepEqual(readPage(doc(tiles(0, 3, [1, 2]) + table(0, 1, [9])), host), {
    items: [
      { id: '1', url: url(1), title: 'Addetto esempio 1', location: 'Torino' },
      { id: '2', url: url(2), title: 'Addetto esempio 2', location: 'Torino' },
    ],
    total: 3,
    pageSize: 2,
  });
});
void test('detail cleans the description and parses datePosted', () => {
  const result = readDetail(doc(detail()), doc(''));
  assert.equal(result.description, 'Diploma richiesto');
  assert.equal(result.descriptionHtml, '<p>Diploma richiesto</p>');
  assert.equal(result.postedAt?.toISOString(), '2026-11-01T00:00:00.000Z');
});
void test('paging reaches total, maxPages stops it, and company comes from config', async () => {
  const run = async (maxPages: number) => {
    const seen: string[] = [];
    const fetchFake: typeof fetch = async (input) => {
      const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      seen.push(u.searchParams.get('startrow') ?? '');
      return html(u.searchParams.get('startrow') === '0' ? table(0, 3, [1, 2]) : table(2, 3, [3]));
    };
    const result = await createSuccessFactorsSource().search(input, context(fetchFake, { maxPages }, true));
    return { ...result, seen };
  };
  const all = await run(10);
  assert.deepEqual(all.seen, ['0', '2']);
  assert.equal(all.cards.length, 3);
  assert.equal(all.cards[0]?.company, 'Configured employer');
  assert.equal(all.complete, true);
  const capped = await run(1);
  assert.deepEqual(capped.seen, ['0']);
  // The cap left a page unread: not the whole listing.
  assert.notEqual(capped.complete, true);
});
void test('zero results is empty; unknown layout reports a fixed error', async () => {
  const run = async (body: string) =>
    createSuccessFactorsSource().search(
      input,
      context(async () => html(body), {}, true),
    );
  assert.deepEqual((await run('<p>Nessun risultato trovato</p>')).cards, []);
  assert.equal((await run('<p>Nessun risultato trovato</p>')).error, undefined);
  assert.equal((await run('<p>Nessun risultato trovato</p>')).complete, true);
  assert.equal((await run('<p>unexpected</p>')).error?.message, 'successfactors: the search layout changed');
  assert.notEqual((await run('<p>unexpected</p>')).complete, true);
});

void test('429 honors Retry-After and retries, without exposing the response body', async () => {
  const waits: Array<number | null> = [];
  let calls = 0;
  const fetchFake: typeof fetch = async () =>
    ++calls === 1 ? html('private response', 429, { 'retry-after': '7' }) : html(table(0, 1, [1]));
  const ctx = context(fetchFake, {}, true);
  ctx.reportWait = (_site, seconds) => {
    waits.push(seconds);
  };
  const result = await createSuccessFactorsSource().search(input, ctx);
  assert.equal(result.cards.length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(waits, [7, null]);
  assert.equal(ctx.now(), 7000);
});
