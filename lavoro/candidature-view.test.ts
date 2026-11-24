import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectApplications, segmentCounts, type CandidatureSegment } from './candidature-view.ts';
import type { ApplicationStatus } from './schema.ts';

const now = Date.UTC(2026, 10, 14);
const day = 86_400_000;
const row = (key: string, status: ApplicationStatus, ageDays: number) => ({
  key,
  application: { status, appliedAt: now - ageDays * day, interviews: [] },
});
const rows: {
  key: string;
  application: { status: ApplicationStatus; appliedAt: number; interviews: { scheduledAt: number }[] } | null;
}[] = [
  row('pending', 'pending', 3),
  row('stale', 'pending', 30),
  {
    key: 'pending-interview',
    application: { status: 'pending', appliedAt: now - 3 * day, interviews: [{ scheduledAt: now }] },
  },
  row('interview', 'interviewing', 30),
  row('offer', 'offer', 5),
  row('expired', 'expired', 40),
  row('rejected', 'rejected', 9),
  row('withdrawn', 'withdrawn', 9),
  { key: 'plain', application: null },
];
const keys = (segment: CandidatureSegment, status?: ApplicationStatus) =>
  selectApplications(rows, { segment, status, now }).map((entry) => entry.key);

void test('L1 every status is reachable through the filter, the 21-day rule included', () => {
  const all: ApplicationStatus[] = ['pending', 'interviewing', 'offer', 'expired', 'rejected', 'withdrawn'];
  const found = Object.fromEntries(all.map((status) => [status, keys('all', status)]));
  assert.deepEqual(found, {
    pending: ['pending', 'pending-interview'],
    interviewing: ['interview'],
    offer: ['offer'],
    expired: ['stale', 'expired'],
    rejected: ['rejected'],
    withdrawn: ['withdrawn'],
  });
});

void test('L1 segments split by effective status and a posting without an application never shows', () => {
  assert.deepEqual(keys('pending'), ['pending']);
  assert.deepEqual(keys('interview'), ['pending-interview', 'interview', 'offer']);
  assert.deepEqual(keys('closed'), ['stale', 'expired', 'rejected', 'withdrawn']);
  assert.equal(keys('all').length, 8);
  assert.deepEqual(keys('pending', 'rejected'), []);
});

void test('L1 every segment count equals the length of the list it opens, with and without a status', () => {
  const segments: CandidatureSegment[] = ['pending', 'interview', 'closed', 'all'];
  for (const status of [undefined, 'pending', 'interviewing', 'expired', 'rejected'] as const) {
    const counts = segmentCounts(rows, { status, now });
    for (const segment of segments)
      assert.equal(counts[segment], keys(segment, status).length, `${segment} ${status ?? 'any'}`);
  }
});
