import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capturingLog, silentLog, testProfile } from './harness.ts';
import { job, json, pageOf, serve, type Seen } from './fake-indeed.ts';
import { buildQuery, createIndeedSource } from './indeed.ts';
import type { SearchInput, SourceContext } from './source.ts';

// Everything here is invented; the credentials come from the invented profile, the real ones are only in the local config.

const baseQuery = { name: 'Web', keywords: 'web OR "front end"', indeedTerms: ['web developer'] };
function input(patch: Partial<SearchInput> = {}, terms?: string[]): SearchInput {
  return {
    query: { ...baseQuery, indeedTerms: terms ?? baseQuery.indeedTerms },
    location: 'Examplia',
    hoursOld: 36,
    maxResults: 100,
    knownPagesToStop: 1,
    ...patch,
  };
}

function context(patch: Partial<SourceContext> & { fetch: typeof fetch }): SourceContext {
  const profile = testProfile();
  return {
    signal: new AbortController().signal,
    now: () => 0,
    sleep: async () => undefined,
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
    ...patch,
  };
}

const literal = (query: string, name: string) => /^"(?:[^"\\]|\\.)*"/.exec(query.split(`${name}: `)[1] ?? '')?.[0];
const limitOf = (request: Seen) => Number(/limit: (\d+)/.exec(request.query)?.[1]);
const cursorOf = (request: Seen) => (request.query.includes('cursor: ') ? literal(request.query, 'cursor') : undefined);
const titlesOf = (cards: Array<{ title: string }>) => cards.map((card) => card.title);

void test('the query escapes terms, location and cursor as string literals, whatever they hold', () => {
  const hostile = 'x") { evil } # \\ \n "quoted" è';
  const query = buildQuery({ term: hostile, location: hostile, hoursOld: 36, limit: 10, cursor: hostile });
  for (const name of ['what', 'where', 'cursor']) assert.equal(JSON.parse(literal(query, name) ?? ''), hostile, name);
  // the injection attempt never leaves its literal: removing the three literals leaves a query without it
  assert.ok(!query.replaceAll(JSON.stringify(hostile), '').includes('evil'));
});

void test('the query carries the page size, the time window and the cursor only after the first page', () => {
  const first = buildQuery({ term: 'web', location: 'Examplia', hoursOld: 36, limit: 25 });
  assert.match(first, /limit: 25\b/);
  assert.match(first, /field: "dateOnIndeed", start: "36h"/);
  assert.match(first, /radius: 50, radiusUnit: MILES/);
  assert.match(first, /sort: RELEVANCE/);
  assert.ok(!first.includes('cursor'));
  assert.match(
    buildQuery({ term: 'web', location: 'Examplia', hoursOld: 36, limit: 25, cursor: 'c1' }),
    /cursor: "c1"/,
  );
  // a fractional window is rounded up: Indeed takes whole hours
  assert.match(buildQuery({ term: 'web', location: 'Examplia', hoursOld: 1.2, limit: 1 }), /start: "2h"/);
  for (const field of [
    'key',
    'title',
    'sourceEmployerName',
    'datePublished',
    'description { html }',
    'attributes { key }',
  ])
    assert.ok(first.includes(field), field);
});

void test('a search is one POST to the API with the configured identity and the query as JSON', async () => {
  const api = serve(() => json(pageOf([job(1)])));
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.equal(result.error, undefined);
  const [request] = api.requests;
  assert.deepEqual([request?.url, request?.method], ['https://apis.indeed.com/graphql', 'POST']);
  assert.deepEqual(
    {
      type: request?.headers['content-type'],
      key: request?.headers['indeed-api-key'],
      agent: request?.headers['user-agent'],
      info: request?.headers['indeed-app-info'],
      country: request?.headers['indeed-co'],
      locale: request?.headers['indeed-locale'],
    },
    {
      type: 'application/json',
      key: 'invented-key',
      agent: 'Invented/1.0 (Test)',
      info: 'appv=1.0; os=test',
      country: 'IT',
      locale: 'it-IT',
    },
  );
  assert.equal(JSON.parse(literal(request?.query ?? '', 'what') ?? ''), 'web developer');
  assert.equal(JSON.parse(literal(request?.query ?? '', 'where') ?? ''), 'Examplia');
});

void test('a job becomes a card: link from the key and domain, place, date, cleaned description', async () => {
  const api = serve(() => json(pageOf([job(1)])));
  const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.deepEqual(cards, [
    {
      url: 'https://it.indeed.com/viewjob?jk=key1',
      title: 'Backend developer 1',
      company: 'Company 1',
      location: 'Exampleville, EX, Italy',
      site: 'indeed',
      postedAt: new Date(1_790_000_000_000),
      description: 'We use typescript 1',
      descriptionHtml: '<p>We use typescript 1</p>',
      applyUrl: 'https://careers.example/apply/1',
    },
  ]);
});

void test('the domain comes from the config', async () => {
  const profile = testProfile();
  const sources = { indeed: { ...(profile.sources.indeed ?? failMissing()), domain: 'indeed.example' } };
  const api = serve(() => json(pageOf([job(1)])));
  const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch, sources }));
  assert.equal(cards[0]?.url, 'https://indeed.example/viewjob?jk=key1');
});

function failMissing(): never {
  throw new Error('the invented profile has Indeed credentials');
}

void test('the company falls back to the source employer name and then to nothing; place skips what is missing', async () => {
  const api = serve(() =>
    json(
      pageOf([
        job(1, { employer: null }),
        job(2, { employer: { name: null }, sourceEmployerName: null }),
        job(3, { location: { city: null, admin1Code: 'EX' } }),
        job(4, { location: null, datePublished: null }),
      ]),
    ),
  );
  const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.deepEqual(
    cards.map((card) => [card.company, card.location, card.postedAt]),
    [
      ['Source Co 1', 'Exampleville, EX, Italy', new Date(1_790_000_000_000)],
      ['', 'Exampleville, EX, Italy', new Date(1_790_000_000_000)],
      ['Company 3', 'EX, Italy', new Date(1_790_000_000_000)],
      ['Company 4', 'Italy', undefined],
    ],
  );
});

void test('remote and hybrid attributes become the declared mode, hybrid first', async () => {
  const attributes = (...keys: string[]) => keys.map((key) => ({ key }));
  const api = serve(() =>
    json(
      pageOf([
        job(1, { attributes: attributes('DSQF7') }),
        job(2, { attributes: attributes('PAXZC') }),
        job(3, { attributes: attributes('DSQF7', 'PAXZC') }),
        job(4, { attributes: attributes('OTHER') }),
        job(5, { attributes: null }),
      ]),
    ),
  );
  const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.deepEqual(
    cards.map((card) => card.declaredMode),
    ['remote', 'hybrid', 'hybrid', undefined, undefined],
  );
});

void test('the apply link is kept only for a web page outside indeed.com', async () => {
  const apply = (viewJobUrl: unknown) => job(1, { recruit: { viewJobUrl } });
  const urls = [
    ['https://careers.example/apply', 'https://careers.example/apply'],
    ['https://it.indeed.com/rc/clk?jk=1', undefined],
    ['https://indeed.com/x', undefined],
    ['https://notindeed.example/x?from=indeed.com', 'https://notindeed.example/x?from=indeed.com'],
    ['javascript:alert(1)', undefined],
    ['ftp://files.example/x', undefined],
    ['not a url', undefined],
    [null, undefined],
  ] as const;
  for (const [viewJobUrl, expected] of urls) {
    const api = serve(() => json(pageOf([apply(viewJobUrl)])));
    const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
    assert.equal(cards[0]?.applyUrl, expected, String(viewJobUrl));
  }
});

void test('a description with nothing readable leaves the card without one', async () => {
  const api = serve(() =>
    json(pageOf([job(1, { description: { html: '<script>x</script><p> </p>' } }), job(2, { description: null })])),
  );
  const { cards } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.deepEqual(
    cards.map((card) => [card.description, card.descriptionHtml]),
    [
      [undefined, undefined],
      [undefined, undefined],
    ],
  );
});

void test('results that are not a job, or lack a key or a title, are skipped and the rest kept', async () => {
  const api = serve(() =>
    json({
      data: {
        jobSearch: {
          pageInfo: { nextCursor: null },
          results: [
            { job: null },
            {},
            'text',
            { job: job(1, { key: undefined }) },
            { job: job(2, { title: 5 }) },
            { job: job(3) },
          ],
        },
      },
    }),
  );
  const { cards, error } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.equal(error, undefined);
  assert.deepEqual(titlesOf(cards), ['Backend developer 3']);
});

void test('paging follows the cursor, asks only for what is still missing and stops at the cap', async () => {
  const api = serve((_request, index) =>
    json(index === 0 ? pageOf([job(1), job(2)], 'cursor1') : pageOf([job(3), job(4), job(5)])),
  );
  const { cards } = await createIndeedSource().search(input({ maxResults: 60 }), context({ fetch: api.fetch }));
  assert.deepEqual(api.requests.map(limitOf), [60, 58]);
  assert.deepEqual(api.requests.map(cursorOf), [undefined, '"cursor1"']);
  assert.equal(cards.length, 5);

  const capped = serve(() => json(pageOf([job(1), job(2), job(3)], 'more')));
  const found = await createIndeedSource().search(input({ maxResults: 2 }), context({ fetch: capped.fetch }));
  assert.equal(capped.requests.length, 1);
  assert.ok(capped.requests[0]);
  assert.equal(limitOf(capped.requests[0]), 2);
  assert.deepEqual(titlesOf(found.cards), ['Backend developer 1', 'Backend developer 2']);

  // the page size never goes over 100, whatever the cap
  const big = serve(() => json(pageOf([job(1)])));
  await createIndeedSource().search(input({ maxResults: 250 }), context({ fetch: big.fetch }));
  assert.ok(big.requests[0]);
  assert.equal(limitOf(big.requests[0]), 100);
});

void test('paging stops without a cursor and on an empty page', async () => {
  const noCursor = serve(() => json(pageOf([job(1)], null)));
  await createIndeedSource().search(input(), context({ fetch: noCursor.fetch }));
  assert.equal(noCursor.requests.length, 1);
  const empty = serve((_request, index) => json(pageOf(index === 0 ? [job(1)] : [], 'more')));
  const { cards } = await createIndeedSource().search(input(), context({ fetch: empty.fetch }));
  assert.equal(empty.requests.length, 2);
  assert.equal(cards.length, 1);
});

void test('paging stops after knownPagesToStop pages with nothing new, and a new card resets the count', async () => {
  const pages = [[job(1), job(2)], [job(3)], [job(4)], [job(5)], [job(6)]];
  const run = async (knownPagesToStop: number, known: string[]) => {
    const api = serve((_request, index) => json(pageOf(pages[index] ?? [], `c${index}`)));
    const isKnown = (url: string) => known.some((key) => url.endsWith(`jk=${key}`));
    await createIndeedSource().search(input({ knownPagesToStop }), context({ fetch: api.fetch, isKnown }));
    return api.requests.length;
  };
  // pages 1 and 2 are known: one known page is enough to stop at 1, two at 2
  assert.equal(await run(1, ['key1', 'key2', 'key3']), 1);
  assert.equal(await run(2, ['key1', 'key2', 'key3']), 2);
  // known, new, known, new, new: the count never reaches 2 because every new card resets it; the end is the empty 6th page
  assert.equal(await run(2, ['key1', 'key2', 'key4']), 6);
  // 0 never stops on known pages
  assert.equal(await run(0, ['key1', 'key2', 'key3', 'key4', 'key5', 'key6']), 6);
});

void test('every indeedTerms entry is its own series, deduplicated by URL; no terms means the keywords once', async () => {
  const api = serve((request) => json(pageOf(request.query.includes('"alpha"') ? [job(1), job(2)] : [job(2), job(3)])));
  const { cards } = await createIndeedSource().search(input({}, ['alpha', 'beta']), context({ fetch: api.fetch }));
  assert.deepEqual(
    api.requests.map((request) => JSON.parse(literal(request.query, 'what') ?? '')),
    ['alpha', 'beta'],
  );
  assert.deepEqual(titlesOf(cards), ['Backend developer 1', 'Backend developer 2', 'Backend developer 3']);

  const bare = serve(() => json(pageOf([])));
  await createIndeedSource().search(input({}, []), context({ fetch: bare.fetch }));
  assert.deepEqual(
    bare.requests.map((request) => JSON.parse(literal(request.query, 'what') ?? '')),
    ['web OR "front end"'],
  );
});

void test('a failing term keeps the results of the others and reports its error', async () => {
  const api = serve((request) =>
    request.query.includes('"alpha"') ? json({ errors: [{ message: 'boom' }] }, 500) : json(pageOf([job(1)])),
  );
  const result = await createIndeedSource().search(input({}, ['alpha', 'beta']), context({ fetch: api.fetch }));
  assert.deepEqual(titlesOf(result.cards), ['Backend developer 1']);
  assert.match(result.error?.message ?? '', /HTTP 500/);
  assert.equal(api.requests.length, 2);
});

void test('a failure after some pages returns the cards already read with the error', async () => {
  const api = serve((_request, index) => (index === 0 ? json(pageOf([job(1), job(2)], 'more')) : json({}, 502)));
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.equal(result.cards.length, 2);
  assert.match(result.error?.message ?? '', /HTTP 502/);
});

void test('a response without jobSearch is an error with the API codes only, never a message or the body', async () => {
  const body = {
    errors: [
      { message: 'Rate limit reached', extensions: { code: 'THROTTLED' } },
      { message: 'Second problem with "web developer"' },
    ],
    leak: 'TOP-SECRET-BODY',
    data: { other: 'TOP-SECRET-DATA' },
  };
  const api = serve(() => json(body));
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.deepEqual(result.cards, []);
  assert.match(result.error?.message ?? '', /THROTTLED/);
  // A message can echo the search term, which stays out of errors and logs.
  assert.ok(!(result.error?.message ?? '').includes('Second problem'));
  assert.ok(!(result.error?.message ?? '').includes('Rate limit'));
  assert.ok(!(result.error?.message ?? '').includes('TOP-SECRET'));

  const bare = await createIndeedSource().search(input(), context({ fetch: serve(() => json({ data: null })).fetch }));
  assert.match(bare.error?.message ?? '', /no jobSearch/);
});

void test('the same missing jobSearch after a first page keeps that page and reports the error', async () => {
  const api = serve((_request, index) =>
    index === 0 ? json(pageOf([job(1)], 'more')) : json({ errors: [{ extensions: { code: 'GONE' } }] }),
  );
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.equal(result.cards.length, 1);
  assert.match(result.error?.message ?? '', /GONE/);
});

void test('an HTTP error or a broken body says the status or the kind, never the body or the credentials', async () => {
  const status = await createIndeedSource().search(
    input(),
    context({ fetch: serve(() => new Response('TOP-SECRET invented-key', { status: 403 })).fetch }),
  );
  assert.match(status.error?.message ?? '', /HTTP 403/);
  assert.ok(!/TOP-SECRET|invented-key/.test(status.error?.message ?? ''));

  const notJson = await createIndeedSource().search(
    input(),
    context({ fetch: serve(() => new Response('<html>TOP-SECRET</html>', { status: 200 })).fetch }),
  );
  assert.match(notJson.error?.message ?? '', /not JSON/);
  assert.ok(!(notJson.error?.message ?? '').includes('TOP-SECRET'));

  const refused = await createIndeedSource().search(
    input(),
    context({
      fetch: () => {
        throw new TypeError('connect failed for key invented-key at host.example');
      },
    }),
  );
  assert.match(refused.error?.message ?? '', /request failed \(TypeError\)/);
  assert.ok(!/invented-key|host\.example/.test(refused.error?.message ?? ''));
});

void test('cancelling stops paging and returns the cards read, with no error', async () => {
  const controller = new AbortController();
  const api = serve((_request, index) => {
    if (index === 0) {
      queueMicrotask(() => controller.abort());
      return json(pageOf([job(1)], 'more'));
    }
    throw new Error('no request after the cancel');
  });
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch, signal: controller.signal }));
  assert.equal(api.requests.length, 1);
  assert.deepEqual([result.cards.length, result.error], [1, undefined]);
});

void test('cancelling during a request ends it at once, with the cards read and no error', async () => {
  const controller = new AbortController();
  const hang = serve(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        queueMicrotask(() => controller.abort());
      }),
  );
  const result = await createIndeedSource().search(input(), context({ fetch: hang.fetch, signal: controller.signal }));
  assert.deepEqual([result.cards, result.error], [[], undefined]);
});

void test('a request that does not answer in time fails with a timeout, keeping earlier pages', async () => {
  const api = serve((request, index) =>
    index === 0
      ? json(pageOf([job(1)], 'more'))
      : new Promise<Response>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')));
        }),
  );
  const result = await createIndeedSource({ requestTimeoutMs: 20 }).search(input(), context({ fetch: api.fetch }));
  assert.equal(result.cards.length, 1);
  assert.match(result.error?.message ?? '', /timed out/);
});

void test('without credentials in the config nothing is requested', async () => {
  const api = serve(() => json(pageOf([job(1)])));
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch, sources: {} }));
  assert.equal(api.requests.length, 0);
  assert.match(result.error?.message ?? '', /credentials/);
});

void test('it is a search source named indeed whose listing already carries the description', () => {
  const source = createIndeedSource();
  assert.deepEqual([source.name, source.kind, source.describe], ['indeed', 'search', undefined]);
});

void test('each term logs its number, how many cards it gave and whether it failed, and nothing else', async () => {
  const { log, records } = capturingLog();
  const api = serve((request) => (request.query.includes('"alpha"') ? json(pageOf([job(1), job(2)])) : json({}, 500)));
  await createIndeedSource().search(input({}, ['alpha', 'beta']), context({ fetch: api.fetch, log }));
  assert.deepEqual(
    records.filter((record) => record.message === 'Indeed term done').map((record) => record.fields),
    [
      { term: 1, terms: 2, cards: 2, failed: false },
      { term: 2, terms: 2, cards: 0, failed: true },
    ],
  );
  // the failure is logged as its status; no term text, posting or credential reaches the log
  assert.ok(records.some((record) => record.level === 'warn' && record.fields === 'indeed: HTTP 500'));
  assert.ok(!/alpha|beta|Backend|Company|invented|Invented|appv/.test(JSON.stringify(records)));
});

void test('a field of an unexpected type costs that field, not the posting', async () => {
  const api = serve(() =>
    json(
      pageOf([
        job(1, {
          datePublished: '1790000000000',
          location: 'Exampleville',
          attributes: 'DSQF7',
          employer: 5,
          recruit: [],
          description: { html: 7 },
        }),
      ]),
    ),
  );
  const { cards, error } = await createIndeedSource().search(input(), context({ fetch: api.fetch }));
  assert.equal(error, undefined);
  assert.deepEqual(cards, [
    {
      url: 'https://it.indeed.com/viewjob?jk=key1',
      title: 'Backend developer 1',
      company: 'Source Co 1',
      location: 'Italy',
      site: 'indeed',
    },
  ]);
});

void test('a page whose results are all unreadable is an error with the count, not an empty search', async () => {
  const { log, records } = capturingLog();
  const api = serve(() =>
    json({ data: { jobSearch: { pageInfo: {}, results: [{ job: { key: 1 } }, { job: null }, 5] } } }),
  );
  const result = await createIndeedSource().search(input(), context({ fetch: api.fetch, log }));
  assert.deepEqual(result.cards, []);
  assert.equal(result.error?.message, 'indeed: none of the 3 results could be read');
  assert.ok(
    records.some(
      (record) => record.level === 'warn' && record.fields === 'indeed: none of the 3 results could be read',
    ),
  );
});

void test('a term reads at most 200 results, since Indeed refuses a third page', async () => {
  const deep = serve((_request, index) =>
    index < 2
      ? json(
          pageOf(
            Array.from({ length: 100 }, (_, n) => job(index * 100 + n + 1)),
            `page-${index + 1}`,
          ),
        )
      : json({ errors: [{ extensions: { code: 'BAD_USER_INPUT' } }] }),
  );
  const found = await createIndeedSource().search(input({ maxResults: 250 }), context({ fetch: deep.fetch }));
  assert.equal(deep.requests.length, 2);
  assert.equal(found.cards.length, 200);
  assert.equal(found.error, undefined);
});
