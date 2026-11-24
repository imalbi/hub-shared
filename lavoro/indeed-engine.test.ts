import assert from 'node:assert/strict';
import { test } from 'node:test';
import { job, json, pageOf, serve } from './fake-indeed.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { createIndeedSource } from './indeed.ts';
import { collections, knownUrls } from './schema.ts';

// The real Indeed source inside the real engine, with a fetch that serves invented pages: what a collection does
// with them, in the database and in the dry run. The source's own rules are in `indeed.test.ts`.

const frontend = (n: number, patch: Record<string, unknown> = {}) =>
  job(n, { title: `Frontend developer ${n}`, description: { html: `<p>We use typescript</p>` }, ...patch });

/** Two pages: the first holds two postings (the first one remote, with markup that must not score), then one more. */
function pages() {
  return serve((request) =>
    json(
      request.query.includes('cursor:')
        ? pageOf([frontend(3)])
        : pageOf(
            [
              frontend(1, {
                attributes: [{ key: 'DSQF7' }],
                description: { html: '<p>We use typescript</p><script>docker</script><style>docker</style>' },
              }),
              frontend(2),
            ],
            'next',
          ),
    ),
  );
}

const profile = (terms = ['web developer']) =>
  testProfile((p) => {
    p.search.queries = [{ name: 'Web', keywords: 'web', indeedTerms: terms }];
    p.search.knownPagesToStop = 1;
    p.search.knownDays = 5;
  });

void test('a dry run lists what Indeed would give, from the cleaned text, and writes nothing', async () => {
  const api = pages();
  const h = createHarness({ sources: [createIndeedSource()], fetch: api.fetch, profile: profile() });
  const { status, dryRun } = await h.collect('prova');
  assert.equal(status, 'done');
  assert.equal(api.requests.length, 2);
  assert.deepEqual(dryRun.map((row) => row.title).toSorted(), [
    'Frontend developer 1',
    'Frontend developer 2',
    'Frontend developer 3',
  ]);
  const first = dryRun.find((row) => row.title === 'Frontend developer 1');
  assert.deepEqual(
    [first?.site, first?.url, first?.workMode, first?.location],
    ['indeed', 'https://it.indeed.com/viewjob?jk=key1', 'remote', 'Exampleville, EX, Italy'],
  );
  // typescript scores from the text; docker sits inside a script and a style, which the cleaner drops
  assert.ok(first?.reasons.some((reason) => reason.startsWith('typescript:')));
  assert.ok(!first?.reasons.some((reason) => reason.startsWith('docker')));
  assert.equal(rows(h.db).length, 0);
  assert.equal(h.db.select().from(knownUrls).all().length, 0);
  assert.equal(h.notifications.length, 0);
});

void test('a collection saves the postings with their cleaned HTML and notifies once, and the next one stops on the first known page', async () => {
  const api = pages();
  const h = createHarness({ sources: [createIndeedSource()], fetch: api.fetch, profile: profile() });
  assert.equal((await h.collect('raccolta')).status, 'done');
  const saved = rows(h.db).toSorted((a, b) => a.title.localeCompare(b.title));
  assert.equal(saved.length, 3);
  assert.deepEqual(
    saved.map((row) => [row.site, row.description, row.descriptionHtml, row.detailsMissing]),
    [1, 2, 3].map(() => ['indeed', 'We use typescript', '<p>We use typescript</p>', false]),
  );
  assert.deepEqual(
    [saved[0]?.workMode, saved[0]?.applyUrl, saved[0]?.postedAt],
    ['remote', 'https://careers.example/apply/1', new Date(1_790_000_000_000)],
  );
  assert.equal(h.notifications.length, 1);

  const before = api.requests.length;
  await h.collect('raccolta');
  // page 1 is all saved and knownPagesToStop is 1: no second page, nothing new, no second notification
  assert.equal(api.requests.length - before, 1);
  assert.equal(rows(h.db).length, 3);
  assert.equal(h.notifications.length, 1);
});

void test('a term that fails keeps the postings of the other: saved, and the run is reported as failed', async () => {
  const api = serve((request) =>
    request.query.includes('"flaky"')
      ? json({ errors: [{ extensions: { code: 'THROTTLED' } }] }, 429)
      : json(pageOf([frontend(1)])),
  );
  const h = createHarness({
    sources: [createIndeedSource()],
    fetch: api.fetch,
    profile: profile(['steady', 'flaky']),
  });
  const { status } = await h.collect('raccolta');
  // one search (one query on one site) and it broke off: failed, though its cards were saved
  assert.equal(status, 'failed');
  assert.equal(rows(h.db).length, 1);
  assert.deepEqual(
    h.db
      .select()
      .from(collections)
      .all()
      .map((row) => [row.status, row.newCount, row.failedSearches]),
    [['failed', 1, 1]],
  );
});
