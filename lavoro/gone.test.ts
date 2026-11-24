import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeSource, makeCard } from './fake-source.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { jobApplied, jobArchive, jobDeleted, jobs } from './schema.ts';
import type { Card } from './source.ts';

// A source that reads its whole listing (inPA, IRENfutura, SuccessFactors) and says so with `complete` proves that a
// posting it no longer lists is closed: a real collection archives it, unless the owner already acted on it.

const card = (index: number): Card => makeCard('iren', index, { description: 'Plain text' });
const profile = testProfile((p) => (p.search.sites = ['iren']));

function harness() {
  let listed = [0, 1, 2, 3];
  let complete = true;
  const fake = createFakeSource({ name: 'iren', kind: 'list', catalog: () => listed.map(card) });
  const search = fake.search;
  // The fake answers what the listing holds; `complete` is what a real list source adds when it read all of it.
  fake.search = async (input, context) => ({ ...(await search(input, context)), complete });
  const h = createHarness({ sources: [fake], profile });
  return {
    h,
    list: (next: number[], whole = true) => {
      listed = next;
      complete = whole;
    },
  };
}

const keyOf = (h: ReturnType<typeof createHarness>, index: number) =>
  rows(h.db).find((row) => row.url === card(index).url)?.key ?? '';
const archived = (h: ReturnType<typeof createHarness>) =>
  new Set(
    h.db
      .select()
      .from(jobArchive)
      .all()
      .map((row) => row.key),
  );

void test("a posting the complete listing no longer has is archived; the owner's own choices are left alone", async () => {
  const { h, list } = harness();
  await h.collect();
  assert.equal(rows(h.db).length, 4);
  const now = new Date(h.clock.now());
  h.db
    .insert(jobApplied)
    .values({ key: keyOf(h, 1), appliedAt: now, status: 'pending' })
    .run();
  h.db
    .insert(jobDeleted)
    .values({ key: keyOf(h, 2), at: now })
    .run();
  list([0]);
  await h.collect();
  // 1 has an application and 2 is in the trash: only 3 moves; 0 is still listed.
  assert.deepEqual([...archived(h)], [keyOf(h, 3)]);
  assert.equal(h.db.select().from(jobs).all().length, 4);
});

void test('an incomplete or failed listing, a dry run and an empty listing archive nothing', async () => {
  const { h, list } = harness();
  await h.collect();
  list([0], false);
  await h.collect();
  assert.equal(archived(h).size, 0);
  list([0]);
  await h.collect('prova');
  assert.equal(archived(h).size, 0);
  // A site answering with nothing at all is a glitch until proven otherwise.
  list([]);
  await h.collect();
  assert.equal(archived(h).size, 0);
});

void test("postings of another site are not touched by this one's listing", async () => {
  const { h, list } = harness();
  await h.collect();
  const now = new Date(h.clock.now());
  h.db
    .insert(jobs)
    .values({ ...rows(h.db)[0], key: 'other|posting', url: 'https://other.example/1', site: 'inpa', firstSeen: now })
    .run();
  list([0, 1, 2]);
  await h.collect();
  assert.deepEqual([...archived(h)], [keyOf(h, 3)]);
});
