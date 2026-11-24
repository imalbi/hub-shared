import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detail, detailWith, listing } from './fake-manpower.ts';
import { createManpowerSource } from './manpower.ts';
import { createHarness, rows, silentLog, testProfile } from './harness.ts';
import { stableReasons } from './stable.ts';
import type { SearchInput, SourceContext } from './source.ts';
import { requestUrl } from './test-http.ts';

const input: SearchInput = {
  query: { name: 'Web', keywords: '', indeedTerms: [] },
  location: 'Torino',
  hoursOld: 36,
  maxResults: 10,
  knownPagesToStop: 1,
};
function context(fetch: typeof globalThis.fetch, functions = ['ict'], maxPages = 5): SourceContext {
  const profile = testProfile((p) => Object.assign(p, { stable: {} }));
  let now = Date.UTC(2026, 10, 5);
  return {
    signal: new AbortController().signal,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    log: silentLog,
    isKnown: () => false,
    limits: Object.assign(profile.search, { manpower: { city: 'torino', functions, maxPages } }),
    sources: profile.sources,
    stable: profile.stable,
  };
}
const page = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });
void test('M2 contract and salary lead the description and drive stable classification', async () => {
  const ctx = context(async (request) =>
    requestUrl(request).includes('/annuncio-lavoro/')
      ? page(detail)
      : page(listing([{ id: 1, contract: 'Tempo indeterminato', salary: '€ 25000 Annuale' }, { id: 2 }])),
  );
  const result = await createManpowerSource().search(input, ctx);
  assert.match(
    result.cards[0]?.description ?? '',
    /^Contratto: Tempo indeterminato · Retribuzione: € 25000 Annuale\n/u,
  );
  assert.match(result.cards[1]?.description ?? '', /^Contratto: Somministrazione\n/u);
  assert.ok(ctx.stable);
  assert.deepEqual(stableReasons(result.cards[0], ctx.stable), []);
  assert.deepEqual(stableReasons(result.cards[1], ctx.stable), []);
});
void test('M3 follows new pages, stops on empty pages and respects cap', async () => {
  const paths: string[] = [];
  const fetch: typeof globalThis.fetch = async (request) => {
    const path = new URL(requestUrl(request)).pathname;
    if (path.includes('/annuncio-lavoro/')) return page(detail);
    paths.push(path);
    const n = Number(/\/p(\d+)$/u.exec(path)?.[1] ?? 1);
    return page(listing(n === 3 ? [] : [{ id: n }], `${path.replace(/\/p\d+$/u, '')}/p${n + 1}`));
  };
  const source = createManpowerSource();
  const result = await source.search(input, context(fetch));
  assert.equal(result.cards.length, 2);
  assert.equal(paths.length, 3);
  paths.length = 0;
  const capped = await source.search(input, context(fetch, ['ict'], 2));
  assert.equal(capped.cards.length, 2);
  assert.equal(capped.complete, false);
  assert.equal(paths.length, 2);
});
void test('M4 duplicate id across functions has one detail and one card', async () => {
  let details = 0;
  const fetch: typeof globalThis.fetch = async (request) => {
    if (requestUrl(request).includes('/annuncio-lavoro/')) {
      details++;
      return page(detail);
    }
    return page(listing([{ id: 1 }]));
  };
  const result = await createManpowerSource().search(input, context(fetch, ['ict', 'engineering']));
  assert.equal(result.cards.length, 1);
  assert.equal(details, 1);
});
void test('M5 cleans detail blocks and retains the card when detail fails', async () => {
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = requestUrl(request);
    if (url.endsWith('/1')) return page(detailWith('Tempo indeterminato'));
    if (url.endsWith('/2')) return page('private error body', 503);
    return page(listing([{ id: 1 }, { id: 2 }]));
  };
  const ctx5 = context(fetch);
  const result = await createManpowerSource().search(input, ctx5);
  assert.match(result.cards[0]?.description ?? '', /Diploma richiesto\nTurni disponibili/u);
  assert.doesNotMatch(result.cards[0]?.description ?? '', /hidden|NOTE LEGALI/u);
  // Each metadata field stays on its own line, so "Tempo indeterminato" is a whole phrase for description weights.
  assert.match(result.cards[0]?.description ?? '', /\nContratto:\s+Tempo indeterminato\n/u);
  assert.ok(ctx5.stable);
  assert.deepEqual(stableReasons(result.cards[0], ctx5.stable), []);
  assert.equal(result.cards[1]?.description, 'Contratto: Somministrazione');
  assert.equal(result.cards[1]?.detailsMissing, true);
});
void test('M6 a 404 names the function and does not prevent another function', async () => {
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = requestUrl(request);
    if (url.endsWith('/broken')) return page('private body', 404);
    return page(url.includes('/annuncio-lavoro/') ? detail : listing([{ id: 1 }]));
  };
  const result = await createManpowerSource().search(input, context(fetch, ['broken', 'ict']));
  assert.equal(result.error?.message, 'manpower: function broken HTTP 404');
  assert.equal(result.cards.length, 1);
  assert.equal(result.complete, false);
});
void test('M7 requests are spaced across functions and Retry-After is honoured', async () => {
  const times: number[] = [];
  let attempts = 0;
  let ctx: SourceContext;
  ctx = context(
    async (request) => {
      times.push(ctx.now());
      if (++attempts === 1) return page('', 429, { 'retry-after': '7' });
      return page(requestUrl(request).includes('/annuncio-lavoro/') ? detail : listing([{ id: attempts }]));
    },
    ['ict', 'engineering'],
  );
  const result = await createManpowerSource().search(input, ctx);
  assert.equal(result.cards.length, 2);
  assert.equal(times[1] - times[0], 7000);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000);
});
void test('M2 collection selects permanent-contract cards by description weight without treating the agency as stable', async () => {
  const profile = testProfile((p) => {
    p.search.sites = ['manpower'];
    p.filter.allowedLocations = ['torino'];
    Object.assign(p.search, { manpower: { city: 'torino', functions: ['ict'], maxPages: 1 } });
    Object.assign(p.weights, { title: { addetto: 2 }, description: { 'tempo indeterminato': 3 } });
  });
  const fetch: typeof globalThis.fetch = async (request) =>
    page(
      requestUrl(request).includes('/annuncio-lavoro/')
        ? detail
        : listing([{ id: 1, contract: 'Tempo indeterminato' }, { id: 2 }]),
    );
  const h = createHarness({ sources: [createManpowerSource()], fetch, profile });
  await h.collect();
  assert.deepEqual(
    rows(h.db).map((row) => row.title),
    ['Addetto esempio 1'],
  );
});
void test('M3 stops when a linked page repeats only known ids', async () => {
  let lists = 0;
  const fetch: typeof globalThis.fetch = async (request) => {
    const path = new URL(requestUrl(request)).pathname;
    if (path.includes('/annuncio-lavoro/')) return page(detail);
    lists++;
    return page(listing([{ id: 1 }], `/it/trova-lavoro/citta/torino/funzioni/ict/p${lists + 1}`));
  };
  const result = await createManpowerSource().search(input, context(fetch));
  assert.equal(lists, 2);
  assert.equal(result.cards.length, 1);
  assert.equal(result.complete, true);
});
void test('M4 collection saves a duplicate across functions once', async () => {
  const profile = testProfile((p) => {
    p.search.sites = ['manpower'];
    p.filter.allowedLocations = ['torino'];
    Object.assign(p.search, { manpower: { city: 'torino', functions: ['ict', 'engineering'], maxPages: 1 } });
    Object.assign(p.weights, { title: { addetto: 2 }, description: { 'tempo indeterminato': 3 } });
  });
  let details = 0;
  const fetch: typeof globalThis.fetch = async (request) => {
    if (requestUrl(request).includes('/annuncio-lavoro/')) {
      details++;
      return page(detail);
    }
    return page(listing([{ id: 1, contract: 'Tempo indeterminato' }]));
  };
  const h = createHarness({ sources: [createManpowerSource()], fetch, profile });
  await h.collect();
  assert.equal(rows(h.db).length, 1);
  assert.equal(details, 1);
});
void test('M5 known cards skip their detail request', async () => {
  let details = 0;
  const ctx = context(async (request) => {
    if (requestUrl(request).includes('/annuncio-lavoro/')) {
      details++;
      return page(detail);
    }
    return page(listing([{ id: 1 }]));
  });
  ctx.isKnown = () => true;
  const result = await createManpowerSource().search(input, ctx);
  assert.equal(details, 0);
  assert.equal(result.cards[0]?.description, 'Contratto: Somministrazione');
});
