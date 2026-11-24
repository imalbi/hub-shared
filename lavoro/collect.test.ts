import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { createFakeSource, makeCard } from './fake-source.ts';
import { capturingLog, createHarness, rows, testProfile } from './harness.ts';
import { postingKey } from './key.ts';
import { bandoTexts, blacklistRules, collections, jobs, knownUrls, opinions, purgedJobs } from './schema.ts';

const day = 86_400_000;
const titles = (h: ReturnType<typeof createHarness>) =>
  rows(h.db)
    .map((row) => row.title)
    .toSorted();
const cached = (h: ReturnType<typeof createHarness>) =>
  h.db
    .select()
    .from(knownUrls)
    .all()
    .map((row) => row.url);

void test('Indeed declared remote passes outside the preferred areas within Italy', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, { location: 'Otherville, Italy', declaredMode: 'remote', description: 'Plain text' }),
        ],
      }),
    ],
  });
  await h.collect();
  assert.equal(rows(h.db).length, 1);
});

void test('a declared hybrid mode wins over remote wording in an outside location', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, {
            location: 'Remote Otherville, Italy',
            declaredMode: 'hybrid',
            description: 'Plain text',
          }),
        ],
      }),
    ],
  });
  await h.collect();
  assert.equal(rows(h.db).length, 0);
});

void test('outside candidates do not request details when remote is disabled', async () => {
  const source = createFakeSource({ catalog: () => [makeCard('indeed', 1, { location: 'Otherville, Italy' })] });
  const h = createHarness({
    sources: [source],
    profile: testProfile((p) => {
      p.filter.keepRemote = false;
    }),
  });
  await h.collect();
  assert.equal(source.record.described.length, 0);
  assert.equal(rows(h.db).length, 0);
});

void test('a declared hybrid mode is not saved as remote when a stale remote flag is set', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [makeCard('indeed', 1, { remote: true, declaredMode: 'hybrid', description: 'Plain text' })],
      }),
    ],
  });
  await h.collect();
  assert.equal(rows(h.db)[0]?.workMode, 'hybrid');
  assert.equal(rows(h.db)[0]?.isRemote, false);
});

void test('a fetched description saves its clean HTML alongside its text', async () => {
  const source = createFakeSource({ catalog: () => [makeCard('indeed', 1)] });
  const h = createHarness({
    sources: [{ ...source, describe: async () => ({ text: 'We use typescript', html: '<p>We use typescript</p>' }) }],
  });
  await h.collect();
  assert.equal(rows(h.db)[0]?.description, 'We use typescript');
  assert.equal(rows(h.db)[0]?.descriptionHtml, '<p>We use typescript</p>');
});

void test('a second collection adds no duplicates, by URL or by comparison key with another legal form or accent', async () => {
  let cards = [makeCard('indeed', 1, { company: 'Café Rossi S.r.l.' }), makeCard('indeed', 2)];
  const source = createFakeSource({ catalog: () => cards, describe: () => 'Plain text' });
  const h = createHarness({
    sources: [source],
    // the cache would hide the duplicates before history sees them
    profile: testProfile((p) => (p.search.knownDays = 0)),
  });
  await h.collect();
  assert.equal(rows(h.db).length, 2);
  cards = [
    makeCard('indeed', 1, { company: 'Café Rossi S.r.l.' }),
    makeCard('indeed', 2, {
      url: 'https://indeed.example/jobs/another-url',
      title: 'Frontend developer 1',
      company: 'Cafe Rossi SRL',
    }),
    makeCard('indeed', 3),
  ];
  source.record.described.length = 0;
  await h.collect();
  assert.deepEqual(titles(h), ['Frontend developer 1', 'Frontend developer 2', 'Frontend developer 3']);
  // duplicates are dropped before any description is fetched: only the new posting costs a request
  assert.deepEqual(source.record.described, ['https://indeed.example/jobs/3']);
  // the notification of the second run lists the one new posting only
  assert.equal(h.notifications.length, 2);
  assert.match(h.notifications[1]?.[4] ?? '', /^Frontend developer 3 \(Company 3\)$/);
});

void test('a saved row is never overwritten, including a manual edit', async () => {
  const card = makeCard('indeed', 1);
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [card], describe: () => 'A changed description with typescript' })],
    profile: testProfile((p) => (p.search.knownDays = 0)),
  });
  await h.collect();
  const [saved] = rows(h.db);
  h.db
    .update(jobs)
    .set({ title: 'Edited by hand', score: 99, description: 'mine' })
    .where(eq(jobs.key, saved?.key ?? ''))
    .run();
  await h.collect();
  const [after] = rows(h.db);
  assert.equal(rows(h.db).length, 1);
  assert.deepEqual(
    [after?.key, after?.title, after?.score, after?.description],
    [saved?.key, 'Edited by hand', 99, 'mine'],
  );
  assert.equal(h.notifications.length, 1);
});

void test('a blacklist-excluded row is saved without notice, kept while the rule holds, and replaced with its first_seen once the rule is off', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({ catalog: () => [makeCard('indeed', 1), makeCard('indeed', 7, { company: 'Shady Corp' })] }),
    ],
  });
  const rule = h.db
    .insert(blacklistRules)
    .values({ field: 'company', matchType: 'contains', value: 'shady', createdAt: new Date(0) })
    .returning({ id: blacklistRules.id })
    .get();
  const firstRun = h.deps.clock.now();
  const first = await h.collect();
  const shady = () => rows(h.db).find((row) => row.company === 'Shady Corp');
  assert.equal(shady()?.blacklistRule, rule?.id);
  assert.equal(first.progresses.at(-1)?.excludedCount, 1);
  assert.equal(h.notifications.length, 1);
  assert.doesNotMatch(h.notifications[0]?.[4] ?? '', /Shady/);

  h.db.update(jobs).set({ title: 'Edited by hand' }).where(eq(jobs.company, 'Shady Corp')).run();
  await h.advance(day);
  const second = await h.collect();
  assert.equal(shady()?.blacklistRule, rule?.id);
  // an excluded row already saved is left exactly as it is, manual edit included, and is not counted again
  assert.equal(shady()?.title, 'Edited by hand');
  assert.equal(second.progresses.at(-1)?.excludedCount, 0);
  assert.equal(h.notifications.length, 1);

  h.db.update(blacklistRules).set({ enabled: false }).run();
  await h.advance(day);
  await h.collect();
  assert.equal(shady()?.blacklistRule, null);
  assert.equal(shady()?.firstSeen.getTime(), firstRun);
  assert.equal(rows(h.db).length, 2);
  assert.equal(h.notifications.length, 2);
  assert.match(h.notifications[1]?.[4] ?? '', /Shady Corp/);
});

void test('a rule on the description excludes a posting that would have been listed, without notice', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [makeCard('indeed', 1)], describe: () => 'Night shifts, no remote' })],
  });
  h.db
    .insert(blacklistRules)
    .values({ field: 'description', matchType: 'word', value: 'night', createdAt: new Date(0) })
    .run();
  await h.collect();
  assert.equal(rows(h.db).length, 1);
  assert.notEqual(rows(h.db)[0]?.blacklistRule, null);
  assert.equal(h.notifications.length, 0);
});

void test('a blocked company is dropped by its comparison form', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [makeCard('indeed', 1, { company: 'BLOCKED  Co. S.r.l.' }), makeCard('indeed', 2)],
      }),
    ],
  });
  await h.collect();
  assert.deepEqual(titles(h), ['Frontend developer 2']);
});

void test('a purged key is never saved again', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [makeCard('indeed', 1), makeCard('indeed', 2)] })],
  });
  h.db
    .insert(purgedJobs)
    .values({ key: postingKey('Company 1', 'Frontend developer 1'), purgedAt: new Date(0) })
    .run();
  await h.collect();
  assert.deepEqual(titles(h), ['Frontend developer 2']);
});

void test('bonuses never let a posting in', async () => {
  const bonusOnly = makeCard('indeed', 2, {
    title: 'Developer',
    location: 'Exampleville',
    declaredMode: 'remote',
    remote: true,
  });
  const h = createHarness({ sources: [createFakeSource({ catalog: () => [makeCard('indeed', 1), bonusOnly] })] });
  await h.collect('prova');
  const prova = await h.collect('prova');
  // title 2 + place 3 + remote 2 would pass min_score 5 if bonuses counted; the score itself is 2
  assert.deepEqual(
    prova.dryRun.map((row) => row.title),
    ['Frontend developer 1'],
  );
  await h.collect();
  assert.deepEqual(titles(h), ['Frontend developer 1']);
});

void test('a missing description sets details_missing and keeps the URL out of the cache', async () => {
  const failing = makeCard('indeed', 2);
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [makeCard('indeed', 1), failing],
        describe: (card) => (card.url === failing.url ? new Error('describe failed') : 'Plain text'),
      }),
    ],
  });
  await h.collect();
  const byUrl = new Map(rows(h.db).map((row) => [row.url, row]));
  assert.equal(byUrl.get(failing.url)?.detailsMissing, true);
  assert.equal(byUrl.get(failing.url)?.description, null);
  assert.equal(byUrl.get('https://indeed.example/jobs/1')?.detailsMissing, false);
  assert.deepEqual(cached(h), ['https://indeed.example/jobs/1']);
});

void test('a card whose source could not fetch its detail is saved incomplete and judged again next time', async () => {
  const failing = makeCard('reteinformaticalavoro', 2, { detailsMissing: true });
  const h = createHarness({
    sources: [
      createFakeSource({
        name: 'reteinformaticalavoro',
        kind: 'list',
        catalog: () => [makeCard('reteinformaticalavoro', 1, { description: 'Plain text' }), failing],
      }),
    ],
    profile: testProfile((p) => (p.search.sites = ['reteinformaticalavoro'])),
  });
  await h.collect();
  const byUrl = new Map(rows(h.db).map((row) => [row.url, row]));
  assert.equal(byUrl.get(failing.url)?.detailsMissing, true);
  assert.equal(byUrl.get('https://reteinformaticalavoro.example/jobs/1')?.detailsMissing, false);
  assert.deepEqual(cached(h), ['https://reteinformaticalavoro.example/jobs/1']);
});

void test('descriptions are fetched best title first, so an exhausted budget leaves the best postings complete', async () => {
  let budget = 1;
  const source = createFakeSource({
    catalog: () => [
      makeCard('indeed', 1, { title: 'Developer' }),
      makeCard('indeed', 2, { title: 'Frontend developer' }),
      makeCard('indeed', 3, { title: 'Frontend' }),
    ],
    describe: () => (budget-- > 0 ? 'Plain text' : new Error('request budget spent')),
  });
  const h = createHarness({ sources: [source] });
  await h.collect();
  assert.deepEqual(source.record.described, [
    'https://indeed.example/jobs/2',
    'https://indeed.example/jobs/3',
    'https://indeed.example/jobs/1',
  ]);
  assert.deepEqual(
    rows(h.db).map((row) => [row.url, row.description]),
    [['https://indeed.example/jobs/2', 'Plain text']],
  );
});

void test('the seen cache holds a judged URL for knownDays, and 0 switches it off', async () => {
  const source = () =>
    createFakeSource({
      catalog: () => [makeCard('indeed', 1, { title: 'Developer' })],
      describe: () => 'Nothing relevant here',
    });
  const withCache = source();
  const h = createHarness({ sources: [withCache] });
  await h.collect();
  assert.equal(rows(h.db).length, 0);
  assert.equal(withCache.record.described.length, 1);
  await h.advance(4 * day);
  await h.collect();
  assert.equal(withCache.record.described.length, 1);
  await h.advance(2 * day);
  await h.collect();
  assert.equal(withCache.record.described.length, 2);

  const noCache = source();
  const off = createHarness({ sources: [noCache], profile: testProfile((p) => (p.search.knownDays = 0)) });
  await off.collect();
  await off.collect();
  assert.equal(noCache.record.described.length, 2);
  assert.deepEqual(cached(off), []);
});

void test('incremental paging stops on a page of known URLs, through the cache and history', async () => {
  const catalog = Array.from({ length: 25 }, (_, index) => makeCard('indeed', index));
  const source = createFakeSource({ catalog: () => catalog, pageSize: 10 });
  const h = createHarness({ sources: [source], profile: testProfile((p) => (p.search.knownPagesToStop = 1)) });
  await h.collect();
  assert.equal(source.record.pages, 3);
  assert.equal(rows(h.db).length, 25);
  await h.collect();
  assert.equal(source.record.pages, 4);
});

void test('a search that fails after N cards still saves its N, and the others go on', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({ failAfter: 2 }),
      // other postings: the same ad on two sites would be one posting
      createFakeSource({ name: 'linkedin', catalog: () => [10, 11, 12].map((index) => makeCard('linkedin', index)) }),
    ],
    profile: testProfile((p) => (p.search.sites = ['indeed', 'linkedin'])),
  });
  const result = await h.collect();
  assert.equal(rows(h.db).filter((row) => row.site === 'indeed').length, 2);
  assert.equal(rows(h.db).filter((row) => row.site === 'linkedin').length, 3);
  assert.equal(result.status, 'partial');
  assert.equal(result.progresses.at(-1)?.failedSearches, 1);
  const [last] = h.db.select().from(collections).all();
  assert.deepEqual([last?.status, last?.searches, last?.failedSearches, last?.newCount], ['partial', 2, 1, 5]);
});

void test('a site with no source fails its search, and a run where every search fails is failed', async () => {
  const h = createHarness({ sources: [] });
  const result = await h.collect();
  assert.equal(result.status, 'failed');
  assert.equal(h.notifications.length, 0);
});

const twoQueries = testProfile((p) => {
  p.search.queries = [
    { name: 'Web', keywords: 'web', indeedTerms: [] },
    { name: 'Data', keywords: 'data', indeedTerms: [] },
  ];
});
const byQuery = (input: { query: { name: string } }) =>
  input.query.name === 'Web'
    ? [makeCard('indeed', 1), makeCard('indeed', 2)]
    : [makeCard('indeed', 3), makeCard('indeed', 4)];

void test('cancelling in the middle keeps the searches already saved and still sends the summary', async () => {
  const h = createHarness({ sources: [createFakeSource({ catalog: byQuery, delayMs: 100 })], profile: twoQueries });
  const result = await h.collect('raccolta', 150);
  assert.deepEqual(titles(h), ['Frontend developer 1', 'Frontend developer 2']);
  assert.equal(result.status, 'cancelled');
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0]?.[3] ?? '', /2 nuove offerte/);
  assert.equal(h.db.select().from(collections).get()?.status, 'cancelled');
});

void test('every search is saved before the one notification', async () => {
  const h = createHarness({ sources: [createFakeSource({ catalog: byQuery, delayMs: 100 })], profile: twoQueries });
  await h.collect();
  assert.deepEqual(h.savedAtNotification, [4]);
  assert.deepEqual(h.notifications, [
    [
      '--app-name',
      'Hub',
      '--',
      'Lavoro: 4 nuove offerte',
      // equal totals: the search that finished last was listed last, so its postings come first
      'Frontend developer 3 (Company 3)\nFrontend developer 4 (Company 4)\nFrontend developer 1 (Company 1)\nFrontend developer 2 (Company 2)',
    ],
  ]);
});

void test('collection notification separates positionals with -- and escapes markup characters in scraped titles', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [makeCard('indeed', 1, { title: '--wait <b>x</b>', company: 'Co', description: 'typescript' })],
      }),
    ],
    profile: testProfile((p) => {
      p.filter.minScore = -10;
      p.filter.minTitleScore = -10;
    }),
  });
  await h.collect();
  assert.deepEqual(h.notifications, [
    ['--app-name', 'Hub', '--', 'Lavoro: 1 nuova offerta', '--wait &lt;b&gt;x&lt;/b&gt; (Co)'],
  ]);
});

void test('a dry run saves nothing, caches nothing, notifies nothing and returns what it would list', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: byQuery, describe: () => 'We use typescript' })],
    profile: twoQueries,
  });
  const result = await h.collect('prova');
  assert.equal(rows(h.db).length, 0);
  assert.deepEqual(cached(h), []);
  assert.equal(h.notifications.length, 0);
  assert.equal(result.dryRun.length, 4);
  assert.deepEqual(Object.keys(result.dryRun[0] ?? {}).toSorted(), [
    'categories',
    'company',
    'location',
    'missing',
    'postedAt',
    'reasons',
    'score',
    'site',
    'title',
    'total',
    'url',
    'workMode',
  ]);
  assert.equal(h.db.select().from(collections).get()?.kind, 'prova');
  // the same dry run twice lists the same postings: it left no history behind
  assert.equal((await h.collect('prova')).dryRun.length, 4);
});

void test('dry-run rows carry postedAt and missing', async () => {
  const date = new Date('2026-11-06T10:00:00.000Z');
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [makeCard('indeed', 1, { postedAt: date }), makeCard('indeed', 2, { postedAt: undefined })],
        describe: (card) => {
          if (card.url.endsWith('/1')) throw new Error('fail');
          return 'Typescript developer';
        },
      }),
    ],
  });
  const result = await h.collect('prova');
  assert.equal(result.dryRun.length, 2);
  const row1 = result.dryRun.find((r) => r.url.endsWith('/1'));
  const row2 = result.dryRun.find((r) => r.url.endsWith('/2'));
  assert.equal(row1?.missing, true);
  assert.equal(row1?.postedAt, '2026-11-06T10:00:00.000Z');
  assert.equal(row2?.missing, false);
  assert.equal(row2?.postedAt, null);
});

void test('progress names the site and the searches done, and reports a pause while it lasts', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: byQuery })],
    profile: testProfile((p) => {
      p.search.queries = twoQueries.search.queries.map((query) => ({
        name: query.name,
        keywords: query.keywords,
        indeedTerms: [],
      }));
      p.search.pauseSeconds = 2;
    }),
  });
  const { progresses } = await h.collect();
  assert.equal(progresses[0]?.searchesTotal, 2);
  assert.ok(progresses.some((progress) => progress.waitingSeconds === 2));
  const last = progresses.at(-1);
  assert.deepEqual([last?.searchesDone, last?.site, last?.waitingSeconds, last?.newCount], [2, 'indeed', undefined, 4]);
});

void test('the same posting finished by two sites at once is saved once, though both passed the no-network filters', async () => {
  const posting = (site: string) =>
    makeCard(site, 1, { url: `https://${site}.example/jobs/same`, title: 'Frontend developer', company: 'Same Co' });
  const indeed = createFakeSource({
    catalog: () => [posting('indeed')],
    describe: () => 'Plain text',
    describeDelayMs: 50,
    delayMs: 50,
  });
  const linkedin = createFakeSource({
    name: 'linkedin',
    catalog: () => [posting('linkedin')],
    describe: () => 'Plain text',
    describeDelayMs: 50,
    delayMs: 50,
  });
  const h = createHarness({
    sources: [indeed, linkedin],
    profile: testProfile((p) => (p.search.sites = ['indeed', 'linkedin'])),
  });
  const result = await h.collect();
  // both fetched a description (neither had saved yet), the commit step found the first one's row and kept one
  assert.deepEqual([indeed.record.described.length, linkedin.record.described.length], [1, 1]);
  assert.equal(rows(h.db).length, 1);
  assert.equal(result.status, 'done');
  assert.equal(h.notifications.length, 1);
  assert.match(h.notifications[0]?.[3] ?? '', /1 nuova offerta/);
});

void test('the cleaned HTML a card carries is saved next to its text, and a described card has none', async () => {
  const withHtml = makeCard('indeed', 1, {
    description: 'We use typescript',
    descriptionHtml: '<p>We use typescript</p>',
  });
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [withHtml, makeCard('indeed', 2)],
        describe: () => 'Text that mentions typescript',
      }),
    ],
  });
  await h.collect();
  const saved = Object.fromEntries(rows(h.db).map((row) => [row.title, row]));
  assert.equal(saved['Frontend developer 1']?.descriptionHtml, '<p>We use typescript</p>');
  assert.equal(saved['Frontend developer 2']?.descriptionHtml, null);
  assert.equal(saved['Frontend developer 2']?.description, 'Text that mentions typescript');
});

void test('each search logs counts only: cards read, new, outside the places, under the title score, listed', async () => {
  const { log, records } = capturingLog();
  const catalog = () => [
    makeCard('indeed', 1),
    makeCard('indeed', 2),
    makeCard('indeed', 3, { location: 'Faraway, Elsewhere' }),
    makeCard('indeed', 4, { title: 'Cook 4' }),
    makeCard('indeed', 5, { location: 'Faraway, Elsewhere', title: 'Cook 5' }),
  ];
  const h = createHarness({
    sources: [createFakeSource({ catalog, describe: () => 'We use typescript' })],
    log,
    profile: testProfile((p) => (p.search.knownDays = 0)),
  });
  await h.collect('prova');
  const counted = records.filter((record) => record.message === 'Lavoro search ingested');
  assert.deepEqual(
    counted.map((record) => record.fields),
    [
      {
        site: 'indeed',
        read: 5,
        fresh: 5,
        tooOld: 0,
        outsideLocation: 2,
        lowTitle: 1,
        excludedRequirement: 0,
        listed: 2,
        excluded: 0,
      },
    ],
  );
  // numbers and the site name, never a title, a company or a link
  assert.ok(!/Frontend|Cook|Company|example/.test(JSON.stringify(records)));
});

// 16n1: Stabile postings in the collection. The invented profile has minTitleScore 2 and the title "Addetto" is worth 0.
const stableHarness = (catalog: () => ReturnType<typeof makeCard>[], describe?: () => string) =>
  createHarness({
    sources: [createFakeSource({ catalog, ...(describe && { describe }) })],
    profile: testProfile((p) => {
      Object.assign(p, { stable: { companies: ['Banca Esempio'], titleWeights: { addetto: 2, impiegato: 2 } } });
    }),
  });

void test('step 2 keeps a low-title card of a listed company and still counts the same card of another one', async () => {
  const { log, records } = capturingLog();
  const catalog = () => [
    makeCard('indeed', 1, { title: 'Addetto sportello', company: 'Banca Esempio S.p.A.', description: 'Sportello.' }),
    makeCard('indeed', 2, { title: 'Addetto sportello', company: 'Acme Srl', description: 'Sportello.' }),
  ];
  const h = createHarness({
    sources: [createFakeSource({ catalog })],
    log,
    profile: testProfile((p) => {
      Object.assign(p, { stable: { companies: ['Banca Esempio'], titleWeights: { addetto: 2, impiegato: 2 } } });
    }),
  });
  await h.collect();
  const saved = rows(h.db);
  assert.deepEqual(
    saved.map((row) => [row.company, row.categories]),
    [['Banca Esempio S.p.A.', ['Stabile']]],
  );
  const counted = records.find((record) => record.message === 'Lavoro search ingested');
  assert.deepEqual(counted?.fields, {
    site: 'indeed',
    read: 2,
    fresh: 2,
    tooOld: 0,
    outsideLocation: 0,
    lowTitle: 1,
    excludedRequirement: 0,
    listed: 1,
    excluded: 0,
  });
});

void test('a listed company rescues a low-title card, an unlisted company does not', async () => {
  const h = stableHarness(() => [
    makeCard('indeed', 1, { title: 'Addetto', company: 'Banca Esempio', description: 'Sportello.' }),
    makeCard('indeed', 2, {
      title: 'Addetto bis',
      company: 'Acme Srl',
      description: 'Assunzione a tempo indeterminato.',
    }),
  ]);
  await h.collect();
  assert.deepEqual(
    rows(h.db).map((row) => [row.title, row.reasons.filter((reason) => reason.startsWith('stabile:'))]),
    [['Addetto', ['stabile:azienda']]],
  );
});

void test('a Stabile card that asks for a degree is not saved, is counted, and is remembered as seen', async () => {
  const { log, records } = capturingLog();
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, {
            title: 'Impiegato amministrativo',
            company: 'Banca Esempio',
            description: 'Laurea obbligatoria in economia.',
          }),
          makeCard('indeed', 2, {
            title: 'Impiegato tecnico',
            company: 'Banca Esempio',
            description: 'Laurea o diploma.',
          }),
        ],
      }),
    ],
    log,
    profile: testProfile((p) => {
      Object.assign(p, { stable: { companies: ['Banca Esempio'], titleWeights: { addetto: 2, impiegato: 2 } } });
    }),
  });
  const { requirements } = await h.collect();
  assert.deepEqual(requirements, { laurea: 1 });
  assert.deepEqual(
    rows(h.db).map((row) => row.title),
    ['Impiegato tecnico'],
  );
  const counted = records.find((record) => record.message === 'Lavoro search ingested');
  const fields: unknown = counted?.fields;
  assert.equal(
    typeof fields === 'object' && fields !== null && 'excludedRequirement' in fields
      ? fields.excludedRequirement
      : undefined,
    1,
  );
  assert.ok(cached(h).includes('https://indeed.example/jobs/1'), 'a complete text judged once is not fetched again');
});

void test('a posting older than maxAgeDays is dropped, counted and remembered; a recent or undated one is kept', async () => {
  const { log, records } = capturingLog();
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, { postedAt: new Date(Date.UTC(2024, 10, 1)) }),
          makeCard('indeed', 2, { postedAt: new Date(Date.UTC(2026, 9, 1)) }),
          makeCard('indeed', 3),
        ],
        describe: () => 'We use typescript',
      }),
    ],
    log,
  });
  await h.collect();
  assert.deepEqual(titles(h), ['Frontend developer 2', 'Frontend developer 3']);
  const counted = records.find((record) => record.message === 'Lavoro search ingested');
  assert.match(JSON.stringify(counted?.fields), /"tooOld":1/u);
  assert.ok(cached(h).includes(makeCard('indeed', 1).url));
});

void test('P5 collection keeps a bare allowed-province town and drops another province', async () => {
  const source = createFakeSource({
    name: 'inpa',
    kind: 'list',
    catalog: () => [
      makeCard('inpa', 1, { location: "Cuorgne'", description: 'Plain text' }),
      makeCard('inpa', 2, { location: 'Asti', description: 'Plain text' }),
    ],
  });
  const h = createHarness({
    sources: [source],
    profile: testProfile((p) => {
      p.search.sites = ['inpa'];
      Reflect.set(p.filter, 'allowedProvinces', ['TO']);
    }),
  });
  await h.collect();
  assert.deepEqual(
    rows(h.db).map((row) => row.location),
    ["Cuorgne'"],
  );
});

void test('a real collection drops known_urls rows older than knownDays, a dry run deletes nothing', async () => {
  const h = createHarness({ sources: [createFakeSource({ catalog: () => [] })] });
  const now = h.deps.clock.now();
  h.db
    .insert(knownUrls)
    .values([
      { url: 'https://old.example/1', seenAt: new Date(now - 10 * day) },
      { url: 'https://recent.example/1', seenAt: new Date(now - 2 * day) },
    ])
    .run();
  await h.collect('prova');
  assert.deepEqual(cached(h).toSorted(), ['https://old.example/1', 'https://recent.example/1']);
  await h.collect();
  assert.deepEqual(cached(h), ['https://recent.example/1']);
});

void test('knownDays 0 deletes every known_urls row at the start of a real collection', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [] })],
    profile: testProfile((p) => (p.search.knownDays = 0)),
  });
  h.db
    .insert(knownUrls)
    .values({ url: 'https://recent.example/1', seenAt: new Date(h.deps.clock.now()) })
    .run();
  await h.collect();
  assert.deepEqual(cached(h), []);
});

void test('a replaced excluded row keeps its saved Parere and bando text', async () => {
  const h = createHarness({ sources: [createFakeSource({ catalog: () => [makeCard('indeed', 1)] })] });
  h.db
    .insert(blacklistRules)
    .values({ field: 'company', matchType: 'contains', value: 'company 1', createdAt: new Date(0) })
    .run();
  await h.collect();
  const saved = rows(h.db)[0];
  assert.ok(saved && saved.blacklistRule !== null);
  h.db
    .insert(opinions)
    .values({ key: saved.key, verdict: { ok: true }, model: 'm', inputHash: 'h', createdAt: new Date(0) })
    .run();
  h.db
    .insert(bandoTexts)
    .values({ key: saved.key, text: 'bando', fetchedAt: new Date(0) })
    .run();
  h.db.update(blacklistRules).set({ enabled: false }).run();
  await h.advance(day);
  await h.collect();
  assert.equal(rows(h.db)[0]?.blacklistRule, null);
  assert.equal(h.db.select().from(opinions).all().length, 1);
  assert.equal(h.db.select().from(bandoTexts).all().length, 1);
});
