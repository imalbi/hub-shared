import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLinkedinSource } from './linkedin.ts';
import { capturingLog, createHarness, silentLog, testProfile } from './harness.ts';
import { createFakeSource, makeCard } from './fake-source.ts';
import type { SearchInput, SourceContext } from './source.ts';
import { requestUrl } from './test-http.ts';

const input: SearchInput = {
  query: { name: 'Example', keywords: 'backend', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 20,
  knownPagesToStop: 1,
};
const card = (id: number) =>
  `<li class="base-search-card" data-entity-urn="urn:li:jobPosting:${id}"><h3>Developer ${id}</h3><h4>Company</h4><span class="job-search-card__location">Italy</span><time datetime="2026-11-01"></time></li>`;

function setup(replies: Response[]) {
  let now = 0;
  const waits: number[] = [];
  const urls: string[] = [];
  const profile = testProfile();
  Object.assign(profile.search.linkedin, {
    experience: [],
    minIntervalSeconds: 4,
    backoffSeconds: 30,
    maxBackoffSeconds: 120,
    maxAttempts: 3,
    maxConsecutive429: 3,
    retryBudgetSeconds: 300,
  });
  const context: SourceContext = {
    signal: new AbortController().signal,
    fetch: async (url) => {
      urls.push(requestUrl(url));
      return replies.shift() ?? new Response('', { status: 500 });
    },
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
  };
  return { context, waits, urls };
}

void test('reads cards and search parameters, then cleans the description', async () => {
  const h = setup([
    new Response(card(1)),
    new Response('<div class="show-more-less-html__markup"><p>TypeScript</p><script>bad</script></div>'),
  ]);
  const source = createLinkedinSource({ random: () => 0 });
  const result = await source.search(input, h.context);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.url, 'https://www.linkedin.com/jobs/view/1');
  const params = new URL(h.urls[0] ?? '').searchParams;
  assert.equal(params.get('f_TPR'), 'r129600');
  assert.equal(params.get('keywords'), 'backend');
  assert.ok(!params.has('f_E'));
  assert.deepEqual(await source.describe?.(result.cards[0], h.context), {
    text: 'TypeScript',
    html: '<p>TypeScript</p>',
  });
  assert.deepEqual(h.waits, [4000]);
});

void test('retries 429 with exponential backoff and preserves partial pages on failure', async () => {
  const h = setup([
    new Response('', { status: 429 }),
    new Response('', { status: 429 }),
    new Response(Array.from({ length: 10 }, (_, i) => card(i)).join('')),
    new Response('', { status: 500 }),
  ]);
  h.context.limits.linkedin.maxConsecutive429 = 4;
  const result = await createLinkedinSource({ random: () => 0 }).search(input, h.context);
  assert.equal(result.cards.length, 10);
  assert.match(result.error?.message ?? '', /HTTP 500/);
  assert.ok(h.waits.includes(30000));
  assert.ok(h.waits.includes(60000));
  assert.equal(h.urls.length, 4);
});

void test('retry-after seconds and dates win; excessive waits block subsequent requests', async () => {
  for (const header of ['90', new Date(90000).toUTCString()]) {
    const h = setup([new Response('', { status: 429, headers: { 'Retry-After': header } }), new Response(card(1))]);
    const source = createLinkedinSource({ random: () => 0 });
    assert.equal((await source.search(input, h.context)).cards.length, 1);
    assert.ok(h.waits.includes(90000));
  }
  const h = setup([new Response('', { status: 429, headers: { 'Retry-After': '3600' } }), new Response(card(1))]);
  const source = createLinkedinSource({ random: () => 0 });
  assert.ok((await source.search(input, h.context)).error);
  assert.ok((await source.search(input, h.context)).error);
  assert.equal(h.urls.length, 1);
  assert.deepEqual(h.waits, []);
});

void test('request and retry budgets and consecutive 429s stop later requests', async () => {
  for (const kind of ['requests', 'retries', 'consecutive'] as const) {
    const h = setup([
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
      new Response('', { status: 429 }),
    ]);
    if (kind === 'requests') h.context.limits.linkedin.maxRequests = 1;
    if (kind === 'retries') h.context.limits.linkedin.retryBudgetSeconds = 1;
    if (kind === 'consecutive') h.context.limits.linkedin.maxConsecutive429 = 1;
    const source = createLinkedinSource({ random: () => 0 });
    assert.ok((await source.search(input, h.context)).error);
    await assert.rejects(
      source.describe!(
        { url: 'https://www.linkedin.com/jobs/view/1', title: 'Dev', company: 'Co', location: '', site: 'linkedin' },
        h.context,
      ),
    );
    assert.equal(h.urls.length, 1);
  }
});

void test('paging stops on repeats, known cards and the result limit', async () => {
  const full = Array.from({ length: 10 }, (_, i) => card(i)).join('');
  for (const mode of ['repeat', 'known', 'limit'] as const) {
    const h = setup([new Response(full), new Response(full), new Response(full)]);
    if (mode === 'known') h.context.isKnown = () => true;
    const result = await createLinkedinSource({ random: () => 0 }).search(
      { ...input, maxResults: mode === 'limit' ? 3 : 50 },
      h.context,
    );
    assert.equal(result.cards.length, mode === 'limit' ? 3 : 10);
    assert.equal(h.urls.length, mode === 'repeat' ? 2 : 1);
  }
});

void test('empty markup and non-429 errors are not retried and messages stay safe', async () => {
  const h = setup([new Response(''), new Response('private body', { status: 403 })]);
  const source = createLinkedinSource({ random: () => 0 });
  assert.equal((await source.search(input, h.context)).cards.length, 0);
  const result = await source.search(input, h.context);
  assert.equal(result.error?.message, 'linkedin: HTTP 403');
  assert.equal(h.urls.length, 2);
});

void test('collection reports retry waits and a single summary while another source saves', async () => {
  const { log, records } = capturingLog();
  const profile = testProfile((p) => {
    p.search.sites = ['linkedin', 'indeed'];
    p.search.linkedin.maxConsecutive429 = 1;
  });
  const h = createHarness({
    sources: [createLinkedinSource({ random: () => 0 }), createFakeSource({ catalog: () => [makeCard('indeed', 1)] })],
    profile,
    log,
    fetch: async () => new Response('', { status: 429 }),
  });
  const result = await h.collect();
  assert.equal(result.status, 'partial');
  assert.equal(
    h.db
      .select()
      .from((await import('./schema.ts')).jobs)
      .all().length,
    1,
  );
  assert.equal(records.filter((r) => r.message === 'LinkedIn throttle summary').length, 1);
});

void test('retry waits appear in collection progress', async () => {
  let calls = 0;
  const profile = testProfile((p) => {
    p.search.sites = ['linkedin'];
  });
  const h = createHarness({
    sources: [createLinkedinSource({ random: () => 0 })],
    profile,
    fetch: async () => (++calls === 1 ? new Response('', { status: 429 }) : new Response('')),
  });
  const result = await h.collect('prova');
  assert.ok(result.progresses.some((p) => p.waitingSeconds === 20));
});

void test('card fields, omissions, overrides and cleaning use only invented data', async () => {
  const invalid =
    '<li class="base-search-card"><h3>x</h3><h4>y</h4></li><li class="base-search-card" data-entity-urn="urn:li:1"><h3></h3><h4>x</h4></li><li class="base-search-card" data-entity-urn="urn:li:2"><h3>x</h3><h4></h4></li>';
  const h = setup([new Response(card(55) + invalid), new Response('<html></html>')]);
  const source = createLinkedinSource({ random: () => 0 });
  const result = await source.search(
    { ...input, query: { ...input.query, geoId: '123', experience: [1, 3], workTypes: [2, 3] } },
    h.context,
  );
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0]?.company, 'Company');
  assert.equal(result.cards[0]?.location, 'Italy');
  assert.equal(result.cards[0]?.postedAt?.toISOString(), '2026-11-01T00:00:00.000Z');
  const params = new URL(h.urls[0]).searchParams;
  assert.deepEqual(
    [params.get('geoId'), params.get('f_E'), params.get('f_WT'), params.get('sortBy')],
    ['123', '1,3', '2,3', 'DD'],
  );
  assert.ok(source.describe);
  assert.equal(await source.describe(result.cards[0], h.context), '');
});

void test('offset stops at 1000 and start advances by actual card count', async () => {
  const pages = Array.from(
    { length: 100 },
    (_, page) => new Response(Array.from({ length: 10 }, (_, n) => card(page * 10 + n)).join('')),
  );
  const h = setup(pages);
  h.context.limits.linkedin.maxRequests = 200;
  const result = await createLinkedinSource({ random: () => 0 }).search({ ...input, maxResults: 1200 }, h.context);
  assert.equal(result.cards.length, 1000);
  assert.equal(h.urls.length, 100);
  assert.equal(new URL(h.urls[99]).searchParams.get('start'), '990');
});

void test('a retry budget is shared across searches and a new signal starts fresh', async () => {
  const source = createLinkedinSource({ random: () => 0 });
  const h = setup([
    new Response('', { status: 429 }),
    new Response(''),
    new Response('', { status: 429 }),
    new Response(''),
  ]);
  h.context.limits.linkedin.retryBudgetSeconds = 30;
  assert.equal((await source.search(input, h.context)).error, undefined);
  assert.ok((await source.search(input, h.context)).error);
  assert.equal(h.urls.length, 3);
  const next = setup([new Response('', { status: 429 }), new Response('')]);
  next.context.limits.linkedin.retryBudgetSeconds = 30;
  assert.equal((await source.search(input, next.context)).error, undefined);
});

void test('three consecutive 429s stop the circuit and do not expose response content', async () => {
  const h = setup(Array.from({ length: 3 }, () => new Response('sensitive response', { status: 429 })));
  const result = await createLinkedinSource({ random: () => 0 }).search(input, h.context);
  assert.equal(h.urls.length, 3);
  assert.equal(result.error?.message, 'linkedin: consecutive HTTP 429');
  assert.doesNotMatch(result.error?.message ?? '', /sensitive|backend|https:/);
});

void test('the 180 second retry limit includes time spent waiting for the request interval', async () => {
  const h = setup([new Response('', { status: 429 }), new Response('', { status: 429 }), new Response(card(1))]);
  Object.assign(h.context.limits.linkedin, { minIntervalSeconds: 170, maxConsecutive429: 4 });
  const result = await createLinkedinSource({ random: () => 0 }).search(input, h.context);
  assert.ok(result.error);
  assert.equal(h.urls.length, 2);
});

void test('a LinkedIn posting becomes eligible when only its description declares remote', async () => {
  const profile = testProfile((p) => {
    p.search.sites = ['linkedin'];
  });
  let requests = 0;
  const h = createHarness({
    sources: [createLinkedinSource({ random: () => 0 })],
    profile,
    fetch: async () =>
      new Response(
        ++requests === 1
          ? card(1).replace('Developer 1', 'Frontend developer').replace('>Italy<', '>Otherville, Italy<')
          : '<div class="show-more-less-html__markup"><p>Fully remote and typescript</p></div>',
      ),
  });
  await h.collect();
  assert.equal(requests, 2);
  assert.equal((await import('./harness.ts')).rows(h.db).length, 1);
});

void test('a foreign posting is rejected before any description request', async () => {
  const profile = testProfile((p) => {
    p.search.sites = ['linkedin'];
  });
  let requests = 0;
  const h = createHarness({
    sources: [createLinkedinSource({ random: () => 0 })],
    profile,
    fetch: async () => {
      requests++;
      return new Response(
        card(1).replace('Developer 1', 'Frontend developer').replace('>Italy<', '>Faraway, Germany<'),
      );
    },
  });
  await h.collect();
  assert.equal(requests, 1);
  assert.equal((await import('./harness.ts')).rows(h.db).length, 0);
});

void test('an outside hybrid posting is excluded after description and counted by location', async () => {
  const { log, records } = capturingLog();
  const profile = testProfile((p) => {
    p.search.sites = ['linkedin'];
  });
  let requests = 0;
  const h = createHarness({
    sources: [createLinkedinSource({ random: () => 0 })],
    profile,
    log,
    fetch: async () =>
      new Response(
        ++requests === 1
          ? card(1).replace('Developer 1', 'Frontend developer').replace('>Italy<', '>Otherville, Italy<')
          : '<div class="show-more-less-html__markup"><p>Hybrid work and typescript</p></div>',
      ),
  });
  await h.collect();
  assert.equal(requests, 2);
  assert.equal((await import('./harness.ts')).rows(h.db).length, 0);
  assert.deepEqual(records.find((r) => r.message === 'Lavoro search ingested')?.fields, {
    site: 'linkedin',
    read: 1,
    fresh: 1,
    known: 0,
    tooOld: 0,
    outsideLocation: 1,
    lowTitle: 0,
    excludedRequirement: 0,
    listed: 0,
    excluded: 0,
  });
});
