import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { detail, host, html, table, tiles, url } from './fake-successfactors.ts';
import { silentLog, testProfile } from './harness.ts';
import { createSuccessFactorsSource, readDetail, readPage } from './successfactors.ts';
import { requestUrl } from './test-http.ts';
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
void test('detail keeps the role between empty description blocks', () => {
  const result = readDetail(
    doc('<div itemprop="description"></div>' + detail() + '<div itemprop="description"> </div>'),
    doc(''),
  );
  assert.equal(result.description, 'Diploma richiesto');
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

function unified(ids: number[], total = ids.length) {
  return JSON.stringify({
    totalJobs: total,
    jobSearchResult: ids.map((id) => ({
      response: {
        id: String(id),
        unifiedStandardTitle: `Addetto esempio ${id}`,
        unifiedUrlTitle: `example-${id}`,
        jobLocationShort: ['Torino', 'Other place'],
      },
    })),
  });
}
void test('explicit unified mode posts zero-based pages, retains all locations and skips known details', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const ctx = context(
    async (request, init) => {
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      requests.push({ url: requestUrl(request), body });
      return new Response(unified(requests.length === 1 ? [1, 2] : [3], 3));
    },
    { employers: [{ host, company: 'Configured employer', mode: 'unified', locale: 'it_IT' }] },
    true,
  );
  const result = await createSuccessFactorsSource().search(input, ctx);
  assert.equal(result.complete, true);
  assert.equal(result.cards.length, 3);
  assert.equal(result.cards[0]?.url, `https://${host}/job/example-1/1-it_IT/`);
  assert.equal(result.cards[0]?.location, 'Torino; Other place');
  assert.equal(result.cards[0]?.postedAt, undefined);
  assert.deepEqual(
    requests.map((request) => request.body),
    [0, 1].map((pageNumber) => ({ keywords: '', locale: 'it_IT', location: 'Torino', pageNumber, sortBy: 'recent' })),
  );
  assert.ok(requests.every((request) => request.url.endsWith('/services/recruiting/v1/jobs')));
  assert.ok(ctx.now() >= 1000);
});
void test('unified caps, repeated pages and later failure retain partial cards without claiming completeness', async () => {
  for (const response of [unified([1], 3), JSON.stringify({ totalJobs: 3 }), 'private response']) {
    let calls = 0;
    const result = await createSuccessFactorsSource().search(
      input,
      context(
        async () => new Response(++calls === 1 ? unified([1], 3) : response),
        { employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
        true,
      ),
    );
    assert.equal(result.cards.length, 1);
    assert.equal(result.complete, false);
    assert.match(result.error?.message ?? '', /^successfactors: /u);
    assert.ok(!result.error?.message.includes('private response'));
  }
  const capped = await createSuccessFactorsSource().search(
    input,
    context(
      async () => new Response(unified([1], 3)),
      { maxPages: 1, employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
      true,
    ),
  );
  assert.equal(capped.complete, false);
});
void test('unified employer failure does not change HTML employer behavior', async () => {
  const result = await createSuccessFactorsSource().search(
    input,
    context(
      async (request) =>
        requestUrl(request).includes('/services/') ? new Response('private', { status: 500 }) : html(table(0, 1, [1])),
      {
        employers: [
          { host, company: 'API employer', mode: 'unified', locale: 'it_IT' },
          { host: 'other.example.org', company: 'HTML employer' },
        ],
      },
      true,
    ),
  );
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.company, 'HTML employer');
  assert.equal(result.complete, false);
});

void test('unified placeholder roles keep boilerplate text but stay incomplete', async () => {
  const listing = unified([1]).replace('Addetto esempio 1', 'Not Applicable');
  const result = await createSuccessFactorsSource().search(
    input,
    context(
      async (request) =>
        requestUrl(request).includes('/services/')
          ? new Response(listing)
          : html('<div itemprop="description">We are an equal opportunity employer.</div>'),
      { employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
    ),
  );
  assert.equal(result.cards.length, 1);
  assert.match(result.cards[0]?.description ?? '', /equal opportunity/u);
  assert.equal(result.cards[0]?.detailsMissing, true);
});

void test('duplicate unified ids within one page cannot claim a complete listing', async () => {
  const result = await createSuccessFactorsSource().search(
    input,
    context(
      async () => new Response(unified([1, 1], 2)),
      { employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
      true,
    ),
  );
  assert.equal(result.complete, false);
  assert.match(result.error?.message ?? '', /incomplete unified listing/u);
});

void test('unified zero totalJobs without jobSearchResult parses as complete empty listing', async () => {
  const result = await createSuccessFactorsSource().search(
    input,
    context(
      async () => new Response(JSON.stringify({ totalJobs: 0 })),
      { employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
      true,
    ),
  );
  assert.equal(result.complete, true);
  assert.deepEqual(result.cards, []);
  assert.equal(result.error, undefined);
});

void test('unified listing POST and fresh detail GET share the 1000 ms pacing clock', async () => {
  const times: number[] = [];
  const ctx = context(
    async (request) => {
      times.push(ctx.now());
      return requestUrl(request).includes('/services/')
        ? new Response(unified([1]))
        : html('<div itemprop="description"><p>Ruolo tecnico</p></div>');
    },
    { employers: [{ host, company: 'Example', mode: 'unified', locale: 'it_IT' }] },
    false,
  );
  const result = await createSuccessFactorsSource().search(input, ctx);
  assert.equal(result.complete, true);
  assert.equal(result.cards.length, 1);
  assert.equal(times.length, 2);
  assert.ok((times[1] ?? 0) - (times[0] ?? 0) >= 1000);
});
