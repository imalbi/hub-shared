import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detail, host, html, table, url } from './fake-successfactors.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { createSuccessFactorsSource } from './successfactors.ts';
import { knownUrls } from './schema.ts';
import { requestUrl } from './test-http.ts';

const profile = testProfile((p) => {
  p.search.sites = ['successfactors'];
  p.filter.allowedLocations = ['torino'];
  p.search.queries = [{ name: 'Web', keywords: 'ignored', indeedTerms: [] }];
  Object.assign(p.search, {
    successfactors: { employers: [{ host, company: 'Configured employer' }], places: ['Torino'], maxPages: 10 },
  });
  Object.assign(p, { stable: { sites: ['successfactors'], titleWeights: { addetto: 2 } } });
});
void test('engine excludes a degree requirement and keeps the configured company and date', async () => {
  const fetchFake: typeof fetch = async (input) => {
    const u = requestUrl(input);
    return html(
      u.includes('/search/')
        ? table(0, 2, [1, 2])
        : detail(u.includes('/2/') ? 'Laurea obbligatoria' : 'Diploma richiesto'),
    );
  };
  const h = createHarness({ sources: [createSuccessFactorsSource()], fetch: fetchFake, profile });
  const result = await h.collect();
  assert.deepEqual(result.requirements, { laurea: 1 });
  assert.equal(rows(h.db).length, 1);
  assert.equal(rows(h.db)[0]?.company, 'Configured employer');
  assert.equal(rows(h.db)[0]?.description, 'Diploma richiesto');
  assert.ok(rows(h.db)[0]?.postedAt);
});
void test('known details are not fetched again, failed details stay incomplete and requests are spaced', async () => {
  const requests: Array<{ url: string; at: number }> = [];
  let now = () => 0;
  const fetchFake: typeof fetch = async (input) => {
    const u = requestUrl(input);
    requests.push({ url: u, at: now() });
    return u.includes('/search/') ? html(table(0, 2, [1, 2])) : u === url(1) ? html(detail()) : html('busy', 503);
  };
  const h = createHarness({ sources: [createSuccessFactorsSource()], fetch: fetchFake, profile });
  now = h.clock.now;
  await h.collect();
  assert.equal(rows(h.db).find((row) => row.url === url(2))?.detailsMissing, true);
  assert.equal(
    h.db
      .select()
      .from(knownUrls)
      .all()
      .some((row) => row.url === url(2)),
    false,
  );
  for (let i = 1; i < requests.length; i++) assert.ok(requests[i].at - requests[i - 1].at >= 1000);
  const before = requests.length;
  await h.collect();
  assert.equal(
    requests.slice(before).some((request) => request.url === url(1)),
    false,
  );
});
void test('an employer failure does not prevent the next employer being read', async () => {
  const custom = testProfile((p) => {
    p.search.sites = ['successfactors'];
    p.filter.allowedLocations = ['torino'];
    Object.assign(p.search, {
      successfactors: {
        employers: [
          { host: 'broken.example.org', company: 'Broken' },
          { host, company: 'Configured employer' },
        ],
        places: ['Torino'],
        maxPages: 10,
      },
    });
    Object.assign(p, { stable: { sites: ['successfactors'], titleWeights: { addetto: 2 } } });
  });
  const fetchFake: typeof fetch = async (input) => {
    const u = requestUrl(input);
    return u.includes('broken.example.org')
      ? html('secret', 503)
      : html(u.includes('/search/') ? table(0, 1, [1]) : detail());
  };
  const h = createHarness({ sources: [createSuccessFactorsSource()], fetch: fetchFake, profile: custom });
  const result = await h.collect();
  assert.equal(result.status, 'failed');
  assert.equal(rows(h.db)[0]?.company, 'Configured employer');
});
