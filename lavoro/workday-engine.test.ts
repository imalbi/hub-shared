import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from '../../apps/server/src/core/module.ts';
import { detail, employerJobs, employerSite, json, list, posting } from './fake-workday.ts';
import { createHarness, rows, silentLog, testProfile } from './harness.ts';
import { knownUrls } from './schema.ts';
import { requestUrl } from './test-http.ts';
import { createWorkdaySource, publicUrl } from './workday.ts';

function profileWith(employers = [employerSite], maxPages = 10) {
  return testProfile((p) => {
    Object.assign(p.search, { sites: ['workday'], workday: { employers, maxPages } });
    p.filter.allowedLocations = ['torino'];
    Object.assign(p, { stable: { sites: ['workday'], titleWeights: { addetto: 2 } } });
  });
}

void test('Workday retains earlier pages when a later listing page fails', async (t) => {
  const fetchFake: typeof fetch = async (request, init) => {
    if (requestUrl(request).endsWith('/jobs')) {
      const { offset } = z
        .object({ offset: z.number() })
        .parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
      return offset === 0 ? json(list([posting('JR1')], 21)) : json({}, 503);
    }
    return json(detail({ text: 'Diploma richiesto', location: 'Torino' }));
  };
  const h = createHarness({ sources: [createWorkdaySource()], fetch: fetchFake, profile: profileWith() });
  t.after(() => h.db.$client.close());
  const result = await h.collect();
  assert.equal(result.status, 'failed');
  const saved = rows(h.db);
  assert.equal(saved.length, 1);
  assert.match(saved[0]?.description ?? '', /Diploma richiesto/u);
  assert.equal(saved[0]?.detailsMissing, false);
});

void test('W2/W3 Workday paginates by page-1 total, ignores 0 on later pages, merges detail and falls back on detail error', async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const fetchFake: typeof fetch = async (request, init) => {
    const url = requestUrl(request);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? init.body : undefined;
    requests.push({ url, method, body });
    if (url.endsWith('/jobs')) {
      const parsedBody = z.object({ offset: z.number() }).parse(JSON.parse(body ?? '{}'));
      if (parsedBody.offset === 0) {
        return json(
          list(
            Array.from({ length: 20 }, (_, i) =>
              posting(`JR${i + 1}`, {
                locationsText: i === 0 ? '2 Locations' : 'Milano',
                externalPath: `/job/City/Role_${i + 1}`,
              }),
            ),
            21,
          ),
        );
      }
      return json(
        list(
          [
            posting('JR21', {
              locationsText: null,
              externalPath: '/job/Torino/Role_21',
            }),
          ],
          0,
        ),
      );
    }
    if (url.endsWith('/job/City/Role_1')) {
      return json(
        detail({
          text: 'Diploma richiesto',
          location: 'Torino',
          additionalLocations: ['Almese'],
          startDate: '2026-11-12',
        }),
      );
    }
    if (url.endsWith('/job/Torino/Role_21')) {
      return json({}, 503);
    }
    return json(detail({ text: 'Diploma richiesto', location: 'Milano' }));
  };

  const h = createHarness({ sources: [createWorkdaySource()], fetch: fetchFake, profile: profileWith() });
  const result = await h.collect();
  assert.equal(result.status, 'done');
  assert.equal(requests.filter((r) => r.url.endsWith('/jobs')).length, 2);

  const saved = rows(h.db);
  assert.equal(saved.length, 2);
  const first = saved.find((r) => r.url.endsWith('/job/City/Role_1'));
  const fallback = saved.find((r) => r.url.endsWith('/job/Torino/Role_21'));
  assert.equal(first?.location, 'Torino, Almese');
  assert.equal(first?.detailsMissing, false);
  assert.match(first?.description ?? '', /Orario: Full time\nDiploma richiesto/u);
  assert.equal(fallback?.detailsMissing, true);
});

void test('W4/W6 Workday skips known detail, spaces requests by 1s and honours Retry-After on 429', async () => {
  const times: number[] = [];
  let now = () => 0;
  let rateLimitedOnce = false;
  let detailCalls = 0;

  const fetchFake: typeof fetch = async (request) => {
    times.push(now());
    const url = requestUrl(request);
    if (!rateLimitedOnce) {
      rateLimitedOnce = true;
      return json({}, 429, { 'retry-after': '7' });
    }
    if (url.endsWith('/jobs')) {
      return json(list([posting('JR1'), posting('JR2')]));
    }
    detailCalls++;
    return json(
      detail({
        text: url.endsWith('JR2') ? 'Laurea obbligatoria' : 'Diploma richiesto',
      }),
    );
  };

  const h = createHarness({ sources: [createWorkdaySource()], fetch: fetchFake, profile: profileWith() });
  now = h.clock.now;
  const firstRun = await h.collect();
  assert.deepEqual(firstRun.requirements, { laurea: 1 });
  assert.equal(detailCalls, 2);
  assert.ok(times[1] - times[0] >= 7000);
  for (let i = 2; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000);

  assert.equal(
    h.db
      .select()
      .from(knownUrls)
      .all()
      .some((row) => row.url === publicUrl(employerSite, posting('JR1').externalPath)),
    true,
  );

  const before = detailCalls;
  await h.collect();
  assert.equal(detailCalls, before);
});

void test('W5 Workday isolates failing employers and stops incomplete at maxPages', async () => {
  const fetchFake: typeof fetch = async (request) => {
    const url = requestUrl(request);
    if (url.includes('broken.example.org')) return new Response('not-json', { status: 200 });
    if (url.endsWith('/jobs')) {
      return json(list([posting('JR1')], 25));
    }
    return json(detail({ text: 'Diploma richiesto' }));
  };

  const broken = { ...employerJobs, host: 'broken.example.org', company: 'Broken Co' };
  const h = createHarness({
    sources: [createWorkdaySource()],
    fetch: fetchFake,
    profile: profileWith([broken, employerSite], 1),
  });
  const res = await h.collect();
  assert.equal(res.status, 'failed');
  assert.equal(rows(h.db).length, 1);
  assert.equal(rows(h.db)[0]?.company, employerSite.company);

  const single = createHarness({
    sources: [createWorkdaySource()],
    fetch: fetchFake,
    profile: profileWith([employerSite], 1),
  });
  const partialRes = await single.collect();
  assert.equal(partialRes.status, 'done');
  const rawSearch = await createWorkdaySource().search(
    {
      query: { name: 't', keywords: 'x', indeedTerms: [] },
      location: 'Torino',
      hoursOld: 24,
      maxResults: 100,
      knownPagesToStop: 1,
    },
    {
      signal: AbortSignal.timeout(5000),
      fetch: fetchFake,
      now: () => 0,
      sleep: async () => {},
      log: silentLog,
      isKnown: () => false,
      limits: profileWith([employerSite], 1).search,
      sources: {},
    },
  );
  assert.equal(rawSearch.complete, false);
});
