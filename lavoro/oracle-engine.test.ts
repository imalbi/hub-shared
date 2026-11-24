import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detail, employer, json, list, url } from './fake-oracle.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { createOracleSource } from './oracle.ts';
import { knownUrls } from './schema.ts';
import { requestUrl } from './test-http.ts';

function profileWith(employers = [employer]) {
  return testProfile((p) => {
    Object.assign(p.search, { sites: ['oracle'], oracle: { employers, maxPages: 10 } });
    p.filter.allowedLocations = ['torino'];
    Object.assign(p, { stable: { sites: ['oracle'], titleWeights: { addetto: 2 } } });
  });
}
void test('detail is cleaned and degree requirements exclude a posting', async () => {
  const fetchFake: typeof fetch = async (request) => {
    const u = new URL(requestUrl(request));
    return json(
      u.pathname.endsWith('recruitingCEJobRequisitions')
        ? list([1, 2])
        : detail(u.searchParams.get('finder')?.includes('"2"') ? 'Laurea obbligatoria' : 'Diploma richiesto'),
    );
  };
  const h = createHarness({ sources: [createOracleSource()], fetch: fetchFake, profile: profileWith() });
  const result = await h.collect();
  assert.deepEqual(result.requirements, { laurea: 1 });
  assert.equal(rows(h.db).length, 1);
  assert.match(rows(h.db)[0]?.description ?? '', /Diploma richiesto/u);
  assert.match(rows(h.db)[0]?.descriptionHtml ?? '', /^<p>Altre sedi: Altra città, Italy<\/p>/u);
  assert.doesNotMatch(rows(h.db)[0]?.description ?? '', /hidden/u);
});
void test('known details are skipped, failed detail retains short text, requests are spaced', async () => {
  const requests: Array<{ url: string; at: number }> = [];
  let now = () => 0;
  const fetchFake: typeof fetch = async (request) => {
    const target = requestUrl(request);
    const u = new URL(target);
    requests.push({ url: target, at: now() });
    return u.pathname.endsWith('recruitingCEJobRequisitions')
      ? json(list([1, 2]))
      : u.searchParams.get('finder')?.includes('"1"')
        ? json(detail())
        : json({}, 503);
  };
  const h = createHarness({ sources: [createOracleSource()], fetch: fetchFake, profile: profileWith() });
  now = h.clock.now;
  await h.collect();
  const failed = rows(h.db).find((row) => row.url === url(2));
  assert.equal(failed?.detailsMissing, true);
  assert.match(failed?.description ?? '', /Breve descrizione/u);
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
    requests.slice(before).some((request) => new URL(request.url).searchParams.get('finder')?.includes('"1"')),
    false,
  );
});
void test('a failing employer does not prevent reading the next', async () => {
  const fetchFake: typeof fetch = async (request) => {
    const u = new URL(requestUrl(request));
    return u.hostname === 'broken.example.org'
      ? json({}, 503)
      : json(u.pathname.endsWith('recruitingCEJobRequisitions') ? list([1]) : detail());
  };
  const h = createHarness({
    sources: [createOracleSource()],
    fetch: fetchFake,
    profile: profileWith([{ ...employer, host: 'broken.example.org' }, employer]),
  });
  assert.equal((await h.collect()).status, 'failed');
  assert.equal(rows(h.db)[0]?.company, employer.company);
});
