import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bank, detail, enel, listing } from './fake-avature.ts';
import { capturingLog, silentLog, testProfile } from './harness.ts';
import { createAvatureSource } from './avature.ts';
import type { SearchInput, SourceContext } from './source.ts';
import { requestUrl } from './test-http.ts';

const input: SearchInput = {
  query: { name: 'Web', keywords: '', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};
function context(fetch: typeof globalThis.fetch, employers = [bank], maxPages = 10): SourceContext {
  const profile = testProfile((p) => Object.assign(p.search, { avature: { employers, maxPages } }));
  let now = 0;
  return {
    signal: new AbortController().signal,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
  };
}
const page = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });
void test('A2 country gate precedes details', async () => {
  const requests: string[] = [];
  const ctx = context(
    async (request) => {
      const url = requestUrl(request);
      requests.push(url);
      return url.includes('JobDetail')
        ? page(detail)
        : page(
            listing(bank, [
              { id: 1, location: 'Italy' },
              { id: 2, location: 'Bulgaria' },
            ]),
          );
    },
    [bank],
    1,
  );
  const result = await createAvatureSource().search(input, ctx);
  assert.equal(result.cards.length, 1);
  assert.equal(requests.filter((url) => url.includes('JobDetail')).length, 1);
  assert.ok(!requests.some((url) => url.endsWith('/2')));
});
void test('A3 pagination stops at duplicates and respects maxPages', async () => {
  const offsets: number[] = [];
  const fetch: typeof globalThis.fetch = async (request) => {
    const u = new URL(requestUrl(request));
    if (u.pathname.includes('JobDetail')) return page(detail);
    const offset = Number(u.searchParams.get('jobOffset') ?? 0);
    offsets.push(offset);
    return page(
      listing(
        enel,
        (offset === 0 ? [1, 2] : offset === 2 ? [3, 4] : [3, 4]).map((id) => ({ id, location: 'Torino' })),
        4,
        true,
      ),
    );
  };
  const result = await createAvatureSource().search(input, context(fetch, [enel]));
  assert.deepEqual(offsets, [0, 2, 4]);
  assert.equal(result.cards.length, 4);
  assert.equal(result.complete, true);
  offsets.length = 0;
  const capped = await createAvatureSource().search(input, context(fetch, [enel], 1));
  assert.deepEqual(offsets, [0]);
  assert.equal(capped.complete, false);
});
void test('A3 last page without next link makes no further list request', async () => {
  const offsets: number[] = [];
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = new URL(requestUrl(request));
    if (url.pathname.includes('JobDetail')) return page(detail);
    const offset = Number(url.searchParams.get('jobOffset') ?? 0);
    offsets.push(offset);
    return page(listing(enel, [{ id: offset + 1, location: 'Torino' }], 2, offset === 0));
  };
  const result = await createAvatureSource().search(input, context(fetch, [enel]));
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.cards.length, 2);
  assert.equal(result.complete, true);
});
void test('A3 later page without anchors keeps earlier cards and logs', async () => {
  const offsets: number[] = [];
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = new URL(requestUrl(request));
    if (url.pathname.includes('JobDetail')) return page(detail);
    const offset = Number(url.searchParams.get('jobOffset') ?? 0);
    offsets.push(offset);
    return page(offset ? '<html><body>changed</body></html>' : listing(enel, [{ id: 1, location: 'Torino' }], 2, true));
  };
  const ctx = context(fetch, [enel]);
  const capture = capturingLog();
  ctx.log = capture.log;
  const result = await createAvatureSource().search(input, ctx);
  assert.deepEqual(offsets, [0, 1]);
  assert.equal(result.cards.length, 1);
  assert.equal(result.error, undefined);
  assert.equal(capture.records.filter((record) => record.level === 'warn').length, 1);
});
void test('A4 detail text, city, date and fallback', async () => {
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = requestUrl(request);
    if (url.endsWith('/1')) return page(detail);
    if (url.endsWith('/2')) return page('error', 503);
    return page(
      listing(bank, [
        { id: 1, location: 'Italy' },
        { id: 2, location: 'Italy' },
      ]),
    );
  };
  const result = await createAvatureSource().search(input, context(fetch, [bank], 1));
  assert.equal(result.cards[0]?.location, 'Torino, Rivoli');
  assert.match(result.cards[0]?.description ?? '', /Diploma richiesto/u);
  assert.match(result.cards[0]?.description ?? '', /Turni a rotazione/u);
  assert.doesNotMatch(result.cards[0]?.description ?? '', /90001|Italy/u);
  assert.doesNotMatch(result.cards[0]?.description ?? '', /hidden/u);
  assert.equal(result.cards[0]?.postedAt?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(result.cards[1]?.detailsMissing, true);
  assert.ok(result.cards[1]?.description);
});
void test('A5 changed markup isolates employer with fixed error', async () => {
  const fetch: typeof globalThis.fetch = async (request) =>
    requestUrl(request).includes('enel.example.org')
      ? page('<html><body>changed</body></html>')
      : requestUrl(request).includes('JobDetail')
        ? page(detail)
        : page(listing(bank, [{ id: 1, location: 'Italy' }]));
  const result = await createAvatureSource().search(input, context(fetch, [enel, bank], 1));
  assert.equal(result.error?.message, 'avature: the search layout changed');
  assert.equal(result.cards.length, 1);
});
void test('A6 pacing, retry and URL safety', async () => {
  const requests: Array<{ url: string; at: number }> = [];
  let attempts = 0;
  let ctx: SourceContext;
  ctx = context(
    async (request) => {
      const url = requestUrl(request);
      requests.push({ url, at: ctx.now() });
      if (++attempts === 1) return page('', 429, { 'retry-after': '7' });
      return url.includes('JobDetail') ? page(detail) : page(listing(enel, [{ id: 1, location: 'Torino' }]));
    },
    [enel],
    1,
  );
  const result = await createAvatureSource().search(input, ctx);
  assert.equal(result.cards.length, 1);
  assert.equal(requests[1]?.at, 7000);
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].at - requests[i - 1].at >= 1000);
  assert.ok(requests.every((r) => !r.url.toLowerCase().includes('qtvc')));
});
