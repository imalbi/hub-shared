import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeSource, makeCard } from './fake-source.ts';
import { createHarness, rows, testProfile, capturingLog } from './harness.ts';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { jobs, jobApplied, jobDeleted, blacklistRules, knownUrls } from './schema.ts';
import { postingKey } from './key.ts';
import { technicalDescription, differentDescription } from './dedupe-fixture.ts';

for (const directFirst of [true, false]) {
  void test(`same collection keeps the direct employer, direct first: ${directFirst}`, async () => {
    const agency = makeCard('manpower', 1, {
      company: 'Alpha Agenzia',
      title: 'Frontend developer',
      description: technicalDescription,
    });
    const direct = makeCard('direct', 2, {
      company: 'Acme',
      title: 'Frontend developer prodotto',
      description: technicalDescription,
    });
    const h = createHarness({
      sources: [createFakeSource({ catalog: () => (directFirst ? [direct, agency] : [agency, direct]) })],
    });
    await h.collect();
    assert.equal(rows(h.db).length, 1);
    assert.equal(rows(h.db)[0]?.site, 'direct');
    assert.equal(rows(h.db)[0]?.company, 'Acme');
  });
}
for (const [name, description, company, site] of [
  ['unrelated work', differentDescription, 'Alpha Agenzia', 'manpower'],
  ['short description', 'typescripty short description', 'Alpha Agenzia', 'manpower'],
  ['different direct employers', technicalDescription, 'Beta', 'direct'],
]) {
  void test(`similarity keeps distinct postings: ${name}`, async () => {
    const h = createHarness({
      sources: [
        createFakeSource({
          catalog: () => [
            makeCard('direct', 1, { company: 'Acme', title: 'Frontend developer', description: technicalDescription }),
            makeCard(site, 2, { company, title: 'Frontend developer prodotto', description }),
          ],
        }),
      ],
    });
    await h.collect();
    assert.equal(rows(h.db).length, 2);
  });
}
void test('previous collection is deduplicated without replacing its saved identity or source', async () => {
  let direct = false;
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          direct
            ? makeCard('direct', 2, {
                company: 'Acme',
                title: 'Frontend developer prodotto',
                description: technicalDescription,
              })
            : makeCard('manpower', 1, {
                company: 'Alpha Agenzia',
                title: 'Frontend developer',
                description: technicalDescription,
              }),
        ],
      }),
    ],
  });
  await h.collect();
  const before = rows(h.db)[0];
  direct = true;
  await h.collect();
  assert.deepEqual(rows(h.db), [before]);
});

for (const kind of ['raccolta', 'prova'] as const) {
  for (const exact of [true, false]) {
    void test(`separate searches prefer direct once, keep key and selected reference: ${kind}, exact ${exact}`, async () => {
      const agency = makeCard('manpower', 11, {
        company: exact ? 'Acme' : 'Alpha Agenzia',
        title: 'Frontend developer',
        description: technicalDescription,
      });
      const direct = makeCard('direct', 12, {
        company: 'Acme',
        title: exact ? agency.title : 'Frontend developer prodotto',
        description: technicalDescription,
      });
      const log = capturingLog();
      const h = createHarness({
        profile: testProfile((p) => {
          p.search.sites = ['indeed', 'linkedin'];
        }),
        log: log.log,
        sources: [
          createFakeSource({ catalog: () => [agency] }),
          createFakeSource({ name: 'linkedin', delayMs: 100, catalog: () => [direct] }),
        ],
      });
      const result = await h.collect(kind);
      assert.equal(result.dryRun.length, 1);
      assert.equal(result.dryRun[0]?.url, direct.url);
      assert.equal(result.progresses.at(-1)?.newCount, 1);
      if (kind === 'prova') assert.deepEqual(rows(h.db), []);
      else {
        assert.equal(rows(h.db).length, 1);
        assert.equal(rows(h.db)[0]?.key, postingKey(agency.company, agency.title));
        assert.equal(rows(h.db)[0]?.url, direct.url);
      }
    });
  }
}
void test('aliases apply to existing comparison keys without rewriting stored identity', async () => {
  let second = false;
  const profile = testProfile();
  profile.dedupe.companyAliases = { 'Controllata S.r.l.': 'Acme' };
  const h = createHarness({
    profile,
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('direct', second ? 2 : 1, {
            company: second ? 'Acme' : 'Controllata S.r.l.',
            title: 'Frontend developer',
            description: 'short',
          }),
        ],
      }),
    ],
  });
  await h.collect();
  const before = rows(h.db);
  second = true;
  await h.collect();
  assert.deepEqual(rows(h.db), before);
});
for (const state of ['deleted', 'incomplete', 'blacklisted', 'old'] as const) {
  void test(`similarity ignores ${state} historical candidates`, async () => {
    let second = false;
    const h = createHarness({
      sources: [
        createFakeSource({
          catalog: () => [
            makeCard(second ? 'direct' : 'manpower', second ? 2 : 1, {
              company: second ? 'Acme' : 'Alpha Agenzia',
              title: second ? 'Frontend developer prodotto' : 'Frontend developer',
              description: technicalDescription,
            }),
          ],
        }),
      ],
    });
    await h.collect();
    const first = rows(h.db)[0];
    assert.ok(first);
    if (state === 'deleted')
      h.db
        .insert(jobDeleted)
        .values({ key: first.key, at: new Date(h.clock.now()) })
        .run();
    if (state === 'incomplete') h.db.update(jobs).set({ detailsMissing: true }).where(eq(jobs.key, first.key)).run();
    if (state === 'old')
      h.db
        .update(jobs)
        .set({ firstSeen: new Date(0) })
        .where(eq(jobs.key, first.key))
        .run();
    if (state === 'blacklisted') {
      const rule = h.db
        .insert(blacklistRules)
        .values({ field: 'key', matchType: 'equals', value: first.key, createdAt: new Date(h.clock.now()) })
        .returning()
        .get();
      h.db.update(jobs).set({ blacklistRule: rule.id }).where(eq(jobs.key, first.key)).run();
    }
    second = true;
    await h.collect();
    assert.equal(rows(h.db).length, 2);
  });
}
void test('applied agency is protected when direct arrives later in the same run', async () => {
  const agency = makeCard('manpower', 1, { company: 'Alpha Agenzia', description: technicalDescription });
  const h = createHarness({
    profile: testProfile((p) => {
      p.search.sites = ['indeed', 'linkedin'];
    }),
    sources: [
      createFakeSource({ catalog: () => [agency] }),
      createFakeSource({
        name: 'linkedin',
        delayMs: 100,
        catalog: () => {
          h.db
            .insert(jobApplied)
            .values({ key: postingKey(agency.company, agency.title), appliedAt: new Date(h.clock.now()) })
            .run();
          return [makeCard('direct', 2, { company: 'Acme', description: technicalDescription })];
        },
      }),
    ],
  });
  await h.collect();
  assert.equal(rows(h.db).length, 1);
  assert.equal(rows(h.db)[0]?.site, 'manpower');
  assert.equal(h.db.select().from(jobApplied).all().length, 1);
});
void test('similar duplicates are logged as known and cached without errors', async () => {
  const log = capturingLog();
  const second = makeCard('manpower', 2, { company: 'Alpha Agenzia', description: technicalDescription });
  const h = createHarness({
    log: log.log,
    sources: [
      createFakeSource({
        catalog: () => [makeCard('direct', 1, { company: 'Acme', description: technicalDescription }), second],
      }),
    ],
  });
  await h.collect();
  const record = log.records.find((r) => r.message === 'Lavoro search ingested');
  assert.ok(record?.fields && typeof record.fields === 'object' && 'known' in record.fields);
  assert.equal(record.fields.known, 1);
  assert.ok(
    h.db
      .select()
      .from(knownUrls)
      .all()
      .some((row) => row.url === second.url),
  );
});

void test('new aliases match old rows outside the similarity lookback', async () => {
  let second = false;
  const profile = testProfile();
  const h = createHarness({
    profile,
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('direct', second ? 2 : 1, {
            company: second ? 'Acme' : 'Controllata',
            title: 'Frontend developer',
            description: 'short',
          }),
        ],
      }),
    ],
  });
  await h.collect();
  h.db
    .update(jobs)
    .set({ firstSeen: new Date(0) })
    .run();
  const before = rows(h.db);
  profile.dedupe.companyAliases = { Controllata: 'Acme' };
  second = true;
  await h.collect();
  assert.deepEqual(rows(h.db), before);
});

void test('a same-run agency blacklisted while another source waits is never upgraded', async () => {
  const agency = makeCard('manpower', 1, { company: 'Alpha Agenzia', description: technicalDescription });
  const h = createHarness({
    profile: testProfile((p) => {
      p.search.sites = ['indeed', 'linkedin'];
    }),
    sources: [
      createFakeSource({ catalog: () => [agency] }),
      createFakeSource({
        name: 'linkedin',
        delayMs: 100,
        catalog: () => {
          const rule = h.db
            .insert(blacklistRules)
            .values({
              field: 'key',
              matchType: 'equals',
              value: postingKey(agency.company, agency.title),
              createdAt: new Date(h.clock.now()),
            })
            .returning()
            .get();
          h.db.update(jobs).set({ blacklistRule: rule.id }).run();
          return [makeCard('direct', 2, { company: 'Acme', description: technicalDescription })];
        },
      }),
    ],
  });
  await h.collect();
  const saved = rows(h.db);
  assert.equal(saved.length, 2);
  assert.equal(saved.find((row) => row.key === postingKey(agency.company, agency.title))?.site, 'manpower');
  assert.notEqual(saved.find((row) => row.site === 'manpower')?.blacklistRule, null);
});
