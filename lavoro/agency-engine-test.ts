import assert from 'node:assert/strict';
import { test } from 'node:test';
import { context, input } from './list-source-test.ts';
import { capturingLog, createHarness, rows, testProfile } from './harness.ts';
import { createFakeSource, makeCard } from './fake-source.ts';
import { technicalDescription } from './dedupe-fixture.ts';
import { agencySites, postingKey } from './key.ts';
import { requestBody, requestUrl } from './test-http.ts';
import { createScorer } from './score.ts';
import type { Source } from './source.ts';

export type AgencyFixture = {
  site: string;
  source: () => Source;
  settings: object;
  listing: (ids?: number[], next?: boolean) => string;
  detail: (body?: string) => string;
  isDetail: (url: string) => boolean;
};
export function agencyEngineTests(fixture: AgencyFixture) {
  const ctx = (fetch: typeof globalThis.fetch, overrides: object = {}) =>
    context(fetch, { [fixture.site]: { ...fixture.settings, ...overrides } });
  void test(`${fixture.site} AG4 stores the contract header in normal description weights without inferring Stabile`, async () => {
    const result = await fixture.source().search(
      input,
      ctx(
        async (request) => new Response(fixture.isDetail(requestUrl(request)) ? fixture.detail() : fixture.listing()),
      ),
    );
    const card = result.cards[0];
    assert.ok(card);
    const expected =
      fixture.site === 'gigroup'
        ? 'Contratto: Contratto a tempo indeterminato - in azienda'
        : 'Contratto: Tempo indeterminato · Retribuzione: € 28000-30000 annuale';
    assert.equal(card.description?.split('\n')[0], expected);
    const profile = testProfile((p) => {
      Object.assign(p, { stable: { companies: [], sites: [] } });
      Object.assign(p.weights, { description: { 'tempo indeterminato': 3 } });
    });
    const scorer = createScorer(profile);
    assert.equal(scorer.isStable(card), false);
    assert.equal(scorer.score(card).descriptionScore, 3);
    const configured = createScorer(testProfile((p) => Object.assign(p, { stable: { sites: [fixture.site] } })));
    assert.equal(configured.isStable(card), true);
  });
  void test(`${fixture.site} AG5 skips known details, deduplicates repeated URLs across scopes, and retains failed details`, async () => {
    let details = 0;
    const current = ctx(
      async (request) => {
        const url = requestUrl(request);
        if (fixture.isDetail(url)) {
          details++;
          return new Response('PRIVATE', { status: 500 });
        }
        return new Response(fixture.listing([1, 1, 2]));
      },
      { functions: ['ict', 'engineering'] },
    );
    current.isKnown = (url) => /(?:[/_]1\/|jobId=1)$/u.test(url);
    const result = await fixture.source().search(input, current);
    assert.equal(result.cards.length, 2);
    assert.equal(details, 1);
    assert.equal(result.cards[1]?.detailsMissing, true);
    assert.match(result.cards[1]?.description ?? '', /^Contratto: /u);
    assert.equal(result.complete, true);
  });
  void test(`${fixture.site} AG5 follows pagination and marks a page cap incomplete`, async () => {
    let lists = 0;
    const fetch: typeof globalThis.fetch = async (request) => {
      if (fixture.isDetail(requestUrl(request))) return new Response(fixture.detail());
      lists++;
      return new Response(fixture.listing([lists], lists === 1));
    };
    const result = await fixture.source().search(input, ctx(fetch));
    assert.equal(lists, 2);
    assert.equal(result.cards.length, 2);
    assert.equal(result.complete, true);
    lists = 0;
    const capped = await fixture.source().search(input, ctx(fetch, { maxPages: 1 }));
    assert.equal(lists, 1);
    assert.equal(capped.cards.length, 1);
    assert.equal(capped.complete, false);
  });
  void test(`${fixture.site} AG6 isolates failed scopes, sanitizes errors, paces requests and honours Retry-After`, async () => {
    const times: number[] = [];
    let attempts = 0;
    const current = ctx(
      async (request, init) => {
        times.push(current.now());
        if (++attempts === 1) return new Response('', { status: 429, headers: { 'retry-after': '7' } });
        const url = requestUrl(request);
        if ((url + requestBody(init?.body)).includes('broken')) return new Response('PRIVATE', { status: 404 });
        return new Response(fixture.isDetail(url) ? fixture.detail() : fixture.listing());
      },
      { functions: ['broken', 'ict'] },
    );
    const result = await fixture.source().search(input, current);
    assert.equal(result.cards.length, 1);
    assert.equal(result.error?.message, `${fixture.site}: HTTP 404`);
    assert.equal(result.complete, false);
    assert.equal(times[1] - times[0], 7000);
    for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 1000);
    assert.doesNotMatch(result.error?.message ?? '', /PRIVATE|https/u);
  });
  void test(`${fixture.site} AG6 oversized listing and detail bodies fail safely`, async () => {
    const huge = 'x'.repeat(4 * 1024 * 1024 + 1);
    const listing = await fixture.source().search(
      input,
      ctx(async () => new Response(huge)),
    );
    assert.equal(listing.complete, false);
    assert.equal(listing.cards.length, 0);
    const detail = await fixture.source().search(
      input,
      ctx(async (request) => new Response(fixture.isDetail(requestUrl(request)) ? huge : fixture.listing())),
    );
    assert.equal(detail.cards.length, 1);
    assert.equal(detail.cards[0]?.detailsMissing, true);
  });
  void test(`${fixture.site} malformed and empty details retain an incomplete card`, async () => {
    for (const body of ['invalid response', fixture.detail('')]) {
      const result = await fixture.source().search(
        input,
        ctx(async (request) => new Response(fixture.isDetail(requestUrl(request)) ? body : fixture.listing())),
      );
      assert.equal(result.cards.length, 1);
      // Umana has contract prose in its detail even when the role block is empty.
      if (body === 'invalid response' || fixture.site !== 'umana') assert.equal(result.cards[0]?.detailsMissing, true);
    }
  });
  for (const directFirst of [false, true]) {
    void test(`${fixture.site} AG7 prefers direct employer, preserves key and counts known (direct first ${directFirst})`, async () => {
      assert.ok(agencySites.has(fixture.site));
      const result = await fixture.source().search(
        input,
        ctx(
          async (request) =>
            new Response(
              fixture.isDetail(requestUrl(request))
                ? fixture.detail(`<p>${technicalDescription}</p>`)
                : fixture.listing(),
            ),
        ),
      );
      const agency = result.cards[0];
      assert.ok(agency);
      const direct = makeCard('direct', 9, {
        company: 'Officina Esempio',
        title: 'Frontend developer prodotto',
        description: technicalDescription,
      });
      const log = capturingLog();
      const h = createHarness({
        profile: testProfile((p) => {
          p.filter.allowedLocations = ['exampleville', 'examplia'];
        }),
        sources: [createFakeSource({ catalog: () => (directFirst ? [direct, agency] : [agency, direct]) })],
        log: log.log,
      });
      await h.collect();
      const saved = rows(h.db);
      assert.equal(saved.length, 1);
      assert.equal(saved[0]?.site, 'direct');
      assert.equal(saved[0]?.url, direct.url);
      assert.equal(
        saved[0]?.key,
        postingKey(directFirst ? direct.company : agency.company, directFirst ? direct.title : agency.title),
      );
      const record = log.records.find((row) => row.message === 'Lavoro search ingested');
      assert.ok(record?.fields && typeof record.fields === 'object' && 'known' in record.fields);
      assert.equal(record.fields.known, 1);
    });
  }
}
