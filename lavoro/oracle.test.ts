import assert from 'node:assert/strict';
import { test } from 'node:test';
import { employer, host, job, json, list, url } from './fake-oracle.ts';
import { silentLog, testProfile } from './harness.ts';
import { locationPasses } from './location.ts';
import { createOracleSource, detailUrl, listUrl, readPage } from './oracle.ts';
import type { SearchInput, SourceContext } from './source.ts';

const input: SearchInput = {
  query: { name: 'Web', keywords: '', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};
function context(fetch: typeof globalThis.fetch, options: object = {}, known = true): SourceContext {
  const profile = testProfile((p) =>
    Object.assign(p.search, { oracle: { employers: [employer], maxPages: 10, ...options } }),
  );
  let now = 0;
  return {
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
}
void test('list maps configured company, location, date and secondary locations', () => {
  const page = readPage({ items: [{ TotalJobsCount: 2, requisitionList: [job(1), job(2, 'Italy')] }] }, employer);
  assert.equal(page.total, 2);
  assert.deepEqual(
    page.cards.map((card) => [
      card.url,
      card.title,
      card.company,
      card.location,
      card.postedAt?.toISOString(),
      card.description,
    ]),
    [
      [
        url(1),
        'ADDETTO/A esempio 1',
        'Configured employer',
        'Torino, Altra città',
        '2026-11-01T00:00:00.000Z',
        'Altre sedi: Altra città, Italy\nBreve descrizione',
      ],
      [
        url(2),
        'ADDETTO/A esempio 2',
        'Configured employer',
        'Altra città',
        '2026-11-01T00:00:00.000Z',
        'Altre sedi: Altra città, Italy\nBreve descrizione',
      ],
    ],
  );
  const multiCity = readPage(
    {
      items: [
        {
          TotalJobsCount: 1,
          requisitionList: [{ ...job(3, 'Milano, Italy'), secondaryLocations: [{ Name: 'Torino, Italy' }] }],
        },
      ],
    },
    employer,
  );
  assert.equal(multiCity.cards[0]?.location, 'Milano, Torino');
  const { filter } = testProfile((p) => {
    p.filter.allowedLocations = ['torino'];
  });
  assert.equal(locationPasses({ title: 'Addetto', location: multiCity.cards[0]?.location ?? '' }, filter), true);
});
void test('paging uses 25 offsets and reports capped or malformed listings', async () => {
  const run = async (body: unknown, maxPages = 10) => {
    const seen: string[] = [];
    const result = await createOracleSource().search(
      input,
      context(
        async (request) => {
          const u = new URL(
            typeof request === 'string' ? request : request instanceof URL ? request.href : request.url,
          );
          seen.push(u.searchParams.get('finder') ?? '');
          return json(body);
        },
        { maxPages },
      ),
    );
    return { ...result, seen };
  };
  const all = await run(list([1], 26));
  assert.equal(all.seen.length, 2);
  assert.match(all.seen[1] ?? '', /offset=25/u);
  assert.equal(all.complete, true);
  const capped = await run(list([1], 26), 1);
  assert.equal(capped.seen.length, 1);
  assert.equal(capped.complete, false);
  assert.deepEqual((await run(list([], 0))).cards, []);
  for (const body of [{ items: [{ TotalJobsCount: 0 }] }, { items: [{ requisitionList: [] }] }])
    assert.equal((await run(body)).error?.message, 'oracle: the search response changed');
});
void test('URLs use HTTPS, configured host and encoded finder quotes', () => {
  for (const value of [listUrl(employer, 25), detailUrl(employer, '123')]) {
    const u = new URL(value);
    assert.equal(u.protocol, 'https:');
    assert.equal(u.hostname, host);
  }
  const detail = detailUrl(employer, '123');
  assert.match(detail, /%22/u);
  assert.equal(new URL(detail).searchParams.get('finder'), 'ById;Id="123",siteNumber=CX_1');
});
void test('429 honors Retry-After', async () => {
  let calls = 0;
  const waits: Array<number | null> = [];
  const ctx = context(async () => (++calls === 1 ? json({}, 429, { 'retry-after': '7' }) : json(list([1]))));
  ctx.reportWait = (_site, seconds) => waits.push(seconds);
  assert.equal((await createOracleSource().search(input, ctx)).cards.length, 1);
  assert.deepEqual(waits, [7, null]);
  assert.equal(ctx.now(), 7000);
});
