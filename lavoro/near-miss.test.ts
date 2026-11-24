import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeSource, makeCard } from './fake-source.ts';
import { createHarness, testProfile } from './harness.ts';
import { pointsMissing, suggestWords, trimNearMisses } from './near-miss.ts';
import { nearMisses } from './schema.ts';

// The invented profile: minScore 5, minTitleScore 2, title developer +2, description typescript +2, trasferte -1.
const day = 86_400_000;
const keys = (h: ReturnType<typeof createHarness>) =>
  h.db
    .select({ url: nearMisses.url })
    .from(nearMisses)
    .all()
    .map((row) => row.url)
    .toSorted();
const card = (index: number, description: string, patch = {}) =>
  makeCard('indeed', index, { title: 'Developer', description, ...patch });

void test('a posting 2 points under is kept, 4 under, refused by place or judged on its card alone is not', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          card(1, 'typescript'), // score 4: 1 under
          card(2, 'nothing'), // score 2: 3 under, still within the margin
          card(3, 'trasferte'), // score 1: 4 under
          card(4, 'typescript', { location: 'Faraway, Italy' }), // refused by place
          card(5, 'typescript', { description: undefined }), // no text: judged on the card alone
        ],
        describe: () => new Error('no description'),
      }),
    ],
  });
  await h.collect();
  assert.deepEqual(keys(h), ['https://indeed.example/jobs/1', 'https://indeed.example/jobs/2']);
});

void test('nearMiss 0 saves nothing', async () => {
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [card(1, 'typescript')] })],
    profile: testProfile((p) => void Object.assign(p.filter, { nearMiss: 0 })),
  });
  await h.collect();
  assert.deepEqual(keys(h), []);
});

void test('a dry run saves no near miss, and a near miss seen again keeps one row with a later last seen', async () => {
  const h = createHarness({ sources: [createFakeSource({ catalog: () => [card(1, 'typescript')] })] });
  await h.collect('prova');
  assert.deepEqual(keys(h), []);
  await h.collect();
  const [first] = h.db.select().from(nearMisses).all();
  await h.advance(10 * day);
  await h.collect();
  const all = h.db.select().from(nearMisses).all();
  assert.equal(all.length, 1);
  assert.equal(all[0]?.firstSeen.getTime(), first?.firstSeen.getTime());
  assert.ok((all[0]?.lastSeen.getTime() ?? 0) > (first?.lastSeen.getTime() ?? 0));
});

void test('the bound: 301 rows become 300 and a row 31 days old goes', async () => {
  const h = createHarness({ sources: [createFakeSource()] });
  const now = 1_700_000_000_000;
  const row = (n: number, lastSeen: number) => ({
    key: `k${n}`,
    url: `https://x.example/${n}`,
    title: 't',
    company: 'c',
    location: 'l',
    site: 'indeed',
    score: 1,
    titleScore: 1,
    total: 1,
    reasons: [],
    minScore: 5,
    minTitleScore: 2,
    description: null,
    firstSeen: new Date(lastSeen),
    lastSeen: new Date(lastSeen),
  });
  for (let n = 0; n < 301; n++)
    h.db
      .insert(nearMisses)
      .values(row(n, now - n * 1000))
      .run();
  trimNearMisses(h.db, now);
  const left = h.db.select().from(nearMisses).all();
  assert.equal(left.length, 300);
  assert.ok(!left.some((r) => r.key === 'k300'), 'the oldest goes');
  h.db
    .insert(nearMisses)
    .values(row(999, now - 31 * day))
    .run();
  trimNearMisses(h.db, now);
  assert.ok(
    !h.db
      .select()
      .from(nearMisses)
      .all()
      .some((r) => r.key === 'k999'),
  );
});

void test('a collection that saves near misses makes no network call at all, so no Parere', async () => {
  let calls = 0;
  const h = createHarness({
    sources: [createFakeSource({ catalog: () => [card(1, 'typescript')] })],
    fetch: () => {
      calls++;
      throw new Error('no fetch expected');
    },
  });
  await h.collect();
  assert.deepEqual(keys(h), ['https://indeed.example/jobs/1']);
  assert.equal(calls, 0);
});

void test('words to promote are counted through the real gates', () => {
  const profile = testProfile((p) => {
    Object.assign(p.weights, { title: { alfa: 4, beta: 3, gamma: 1 }, description: {} });
    Object.assign(p.filter, { minScore: 5, minTitleScore: 0 });
  });
  const row = (title: string) => ({
    title,
    company: 'c',
    location: 'Exampleville',
    site: 'indeed',
    score: 0,
    titleScore: 0,
    reasons: [],
    description: null,
  });
  // Deficits 1, 2 and 4: with +2 on the word the first two reach 5, the third stays at 3.
  const rows = [row('Manutentore alfa'), row('Manutentore beta'), row('Manutentore gamma'), row('Tirocinio alfa')];
  const found = suggestWords(rows, profile);
  assert.deepEqual(found, [{ word: 'manutentore', postings: 3, entering: 2 }]);
  // "alfa" is already weighted and "tirocinio" is in one title only: neither appears above.
});

void test('pointsMissing is the larger gate deficit, so a posting refused for its title alone never reads 0', () => {
  assert.equal(pointsMissing({ score: 3, titleScore: 2, minScore: 5, minTitleScore: 2 }), 2);
  assert.equal(pointsMissing({ score: 6, titleScore: 0, minScore: 5, minTitleScore: 2 }), 2);
  assert.equal(pointsMissing({ score: 4, titleScore: 0, minScore: 5, minTitleScore: 3 }), 3);
});

void test('a Stabile posting stopped by the floor enters near misses even when dev titleScore is 0', async () => {
  const h = createHarness({
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, {
            title: 'Sistemista Junior',
            company: 'Banca Esempio',
            description: 'Gestione sistemi.',
          }),
        ],
      }),
    ],
    profile: testProfile((p) => {
      Object.assign(p.filter, { minScore: 4, minTitleScore: 4, nearMiss: 4 });
      Object.assign(p, { stable: { companies: ['Banca Esempio'], titleWeights: { tecnico: 3 } } });
    }),
  });
  await h.collect();
  assert.deepEqual(keys(h), ['https://indeed.example/jobs/1']);
});
