import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import { profileSchema } from './config.ts';
import { inventedProfile } from './invented-profile.ts';
import { rescoreJobs } from './rescore.ts';
import { jobs } from './schema.ts';
import { createScorer } from './score.ts';

const migrations = fileURLToPath(new URL('./drizzle', import.meta.url));

void test('rescoreJobs updates score and categories on existing jobs', () => {
  const db = openDatabase(':memory:', migrations);

  // Seed one job with 0 score
  db.insert(jobs)
    .values({
      key: 'test-key-1',
      comparisonKey: 'acme-developer',
      title: 'Developer',
      company: 'Acme',
      location: 'Exampleville',
      site: 'indeed',
      url: 'https://example.com/1',
      score: 0,
      total: 0,
      reasons: [],
      categories: [],
      description: 'Junior frontend web developer position',
      isRemote: false,
      detailsMissing: false,
      firstSeen: new Date(),
    })
    .run();

  // Profile with developer = 5 and exampleville = 3
  const raw = inventedProfile();
  raw.weights.title.developer = 5;
  raw.weights.location.exampleville = 3;
  const profile = profileSchema.parse(raw);
  const scorer = createScorer(profile);

  // 1. Dry run should report updates but not mutate database
  const dryStats = rescoreJobs(db, scorer, profile.filter.minScore, { dryRun: true });
  assert.equal(dryStats.total, 1);
  assert.equal(dryStats.updated, 1);
  assert.equal(dryStats.unchanged, 0);

  const beforeApply = db.select().from(jobs).where(eq(jobs.key, 'test-key-1')).get();
  assert.equal(beforeApply?.score, 0);

  // 2. Apply should write the updated score and total to DB
  const applyStats = rescoreJobs(db, scorer, profile.filter.minScore, { dryRun: false });
  assert.equal(applyStats.total, 1);
  assert.equal(applyStats.updated, 1);

  const afterApply = db.select().from(jobs).where(eq(jobs.key, 'test-key-1')).get();
  assert.equal(afterApply?.score, 5);
  assert.equal(afterApply?.total, 8); // 5 (title) + 3 (location bonus)
  assert.deepEqual(afterApply?.categories, ['Frontend']);

  // 3. Running again with identical scorer should report 0 updated and 1 unchanged
  const noopStats = rescoreJobs(db, scorer, profile.filter.minScore, { dryRun: false });
  assert.equal(noopStats.total, 1);
  assert.equal(noopStats.updated, 0);
  assert.equal(noopStats.unchanged, 1);

  db.$client.close();
});
