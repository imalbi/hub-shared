import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from '../../apps/server/src/core/module.ts';
import { algoliaPage, bootstrapHtml, hit, json } from './fake-synergie.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { jobArchive } from './schema.ts';
import { createSynergieSource } from './synergie.ts';
import { requestUrl } from './test-http.ts';

function profileWith(regions = ['Piemonte'], maxPages = 10) {
  return testProfile((p) => {
    Object.assign(p.search, { sites: ['synergie'], synergie: { regions, maxPages } });
    p.filter.allowedLocations = ['torino'];
    Object.assign(p.weights, { title: { addetto: 2 }, description: { 'tempo indeterminato': 3 } });
    Object.assign(p, { stable: { companies: ['Azienda Stabile'], titleWeights: { operaio: 2 } } });
  });
}

void test('Synergie reads past filtered and duplicate pages without archiving active postings', async (t) => {
  for (const middle of ['filtered', 'duplicate']) {
    await t.test(middle, async (t) => {
      let initial = true;
      const pages: number[] = [];
      const fetchFake: typeof fetch = async (request, init) => {
        if (!requestUrl(request).includes('algolia.net')) return new Response(bootstrapHtml());
        const { page } = z
          .object({ page: z.number() })
          .parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        if (initial) return json(algoliaPage([hit(1), hit(9)]));
        pages.push(page);
        if (page === 0) return json(algoliaPage([hit(1)], 3));
        if (page === 1)
          return json(algoliaPage([middle === 'filtered' ? hit(2, { title: 'Tecnico IRETI' }) : hit(1)], 3));
        return json(algoliaPage([hit(9)], 3));
      };
      const h = createHarness({ sources: [createSynergieSource()], fetch: fetchFake, profile: profileWith() });
      t.after(() => h.db.$client.close());
      await h.collect();
      assert.equal(rows(h.db).length, 2);
      initial = false;
      await h.collect();
      assert.deepEqual(h.db.select().from(jobArchive).all(), []);
      assert.deepEqual(pages, [0, 1, 2]);
    });
  }
});

void test('Synergie paginates Algolia results, filters degree requirements for stable company, paces requests and handles 429', async () => {
  const times: number[] = [];
  let now = () => 0;
  let rateLimitedOnce = false;

  const fetchFake: typeof fetch = async (request, init) => {
    times.push(now());
    const url = requestUrl(request);
    if (!url.includes('algolia.net')) {
      return new Response(bootstrapHtml());
    }
    if (!rateLimitedOnce) {
      rateLimitedOnce = true;
      return json({}, 429, { 'retry-after': '5' });
    }
    const body = z.object({ page: z.number() }).parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
    if (body.page === 0) {
      return json(
        algoliaPage(
          [
            hit(1),
            hit(2, {
              title: 'Operaio esempio 2',
              company: 'Azienda Stabile',
              requirementsHtml: '<p>Laurea obbligatoria</p>',
            }),
          ],
          2,
        ),
      );
    }
    return json(algoliaPage([hit(3, { title: 'Addetto esempio 3' })], 2));
  };

  const h = createHarness({ sources: [createSynergieSource()], fetch: fetchFake, profile: profileWith() });
  now = h.clock.now;
  const result = await h.collect();
  assert.equal(result.status, 'done');
  assert.deepEqual(result.requirements, { laurea: 1 });
  assert.equal(rows(h.db).length, 2);
  assert.ok(times[2] - times[1] >= 5000);
  for (let i = 1; i < times.length; i++) {
    if (i === 2) continue;
    assert.ok(times[i] - times[i - 1] >= 1000);
  }
});

void test('Synergie deduplicates across regions, isolates failing regions and marks maxPages cap partial', async () => {
  const fetchFake: typeof fetch = async (request, init) => {
    const url = requestUrl(request);
    if (!url.includes('algolia.net')) return new Response(bootstrapHtml());
    const body = z
      .object({ facetFilters: z.array(z.array(z.string())) })
      .parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
    const regionFilter = body.facetFilters[0]?.[0] ?? '';
    if (regionFilter.includes('Lombardia')) return json({}, 503);
    return json(algoliaPage([hit(1)], 3));
  };

  const h = createHarness({
    sources: [createSynergieSource()],
    fetch: fetchFake,
    profile: profileWith(['Lombardia', 'Piemonte'], 1),
  });
  const result = await h.collect();
  assert.equal(result.status, 'failed');
  assert.equal(rows(h.db).length, 1);
  assert.equal(rows(h.db)[0]?.site, 'synergie');
});
