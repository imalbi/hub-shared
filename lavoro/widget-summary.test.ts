import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobRow } from './server.ts';
import { summarizeLavoro } from './widget-summary.ts';

const DAY_MS = 86_400_000;
const now = new Date(2026, 10, 20, 14, 0).getTime();

function makeJob(
  key: string,
  overrides: Partial<JobRow> & {
    opinion?: JobRow['opinion'];
    application?: JobRow['application'];
  } = {},
): JobRow {
  return {
    key,
    comparisonKey: key,
    title: `Ruolo ${key}`,
    company: `Azienda ${key}`,
    location: 'Torino',
    site: 'indeed',
    url: `https://example.invalid/jobs/${key}`,
    applyUrl: null,
    score: 15,
    total: 15,
    reasons: [],
    categories: [],
    description: null,
    descriptionHtml: null,
    workMode: 'hybrid',
    isRemote: false,
    detailsMissing: false,
    postedAt: null,
    firstSeen: now - 3_600_000,
    importedAt: null,
    blacklistRule: null,
    archivedAt: null,
    deletedAt: null,
    application: null,
    companyApplications: [],
    opinion: null,
    ...overrides,
  };
}

void test('D3 summarizeLavoro counts possibilities including legacy verdicts and ranks top 4 alta then media like shortlist', () => {
  const jobs: JobRow[] = [
    // Two alta: one modern high-total, one legacy 'candidati' with low total (must still beat media/bassa).
    makeJob('alta-hi', {
      total: 24,
      opinion: { verdict: 'alta', possibility: 'alta', codes: [], unverified: [], outdated: false },
    }),
    makeJob('alta-legacy', {
      total: 8,
      opinion: { verdict: 'candidati', possibility: 'alta', codes: [], unverified: [], outdated: true },
    }),
    // Three media: best two should follow alta in top 4 even when scores exceed alta-legacy.
    makeJob('media-1', {
      total: 26,
      opinion: { verdict: 'media', possibility: 'media', codes: ['salary'], unverified: ['RAL'], outdated: false },
    }),
    makeJob('media-2', {
      total: 19,
      firstSeen: now - 2 * DAY_MS,
      opinion: { verdict: 'chiedi prima', possibility: 'media', codes: ['domain'], unverified: [], outdated: false },
    }),
    makeJob('media-3', {
      total: 11,
      opinion: { verdict: 'media', possibility: 'media', codes: [], unverified: [], outdated: false },
    }),
    // Bassa & fuori: counted in byPossibility, never returned in top.
    makeJob('bassa-1', {
      total: 30,
      opinion: { verdict: 'bassa', possibility: 'bassa', codes: [], unverified: [], outdated: false },
    }),
    makeJob('bassa-2', {
      total: 12,
      opinion: { verdict: 'scarta', possibility: 'bassa', codes: [], unverified: [], outdated: false },
    }),
    makeJob('fuori-1', {
      total: 29,
      opinion: { verdict: 'fuori', possibility: 'fuori', codes: ['salary'], unverified: [], outdated: false },
    }),
    // Unjudged review item: counted in review & reviewToday, absent from top/byPossibility.
    makeJob('unjudged', { total: 28 }),
    // Applied alta job: excluded from review & top, counted in pending.
    makeJob('applied-alta', {
      total: 32,
      opinion: { verdict: 'alta', possibility: 'alta', codes: [], unverified: [], outdated: false },
      application: { appliedAt: now - 2 * DAY_MS, status: 'pending', closedAt: null, reason: null, notes: null },
    }),
  ];

  const summary = summarizeLavoro(jobs, [], now, now - 7_200_000);
  assert.equal(summary.review, 9);
  assert.equal(summary.reviewToday, 8);
  assert.deepEqual(summary.byPossibility, { alta: 2, media: 3, bassa: 2, fuori: 1 });
  assert.equal(summary.pending, 1);
  assert.equal(summary.interviewing, 0);
  assert.deepEqual(
    summary.top.map((item) => item.key),
    ['alta-hi', 'alta-legacy', 'media-1', 'media-2'],
  );
  assert.equal(summary.top[1].possibility, 'alta');
  assert.equal(summary.top[1].outdated, true);
  assert.equal(summary.lastCollectionAt, now - 7_200_000);

  // When >=3 alta and >=1 media exist, reserve two slots per group so Possibilità media stays populated in Grande.
  const crowded = summarizeLavoro(
    [
      ...jobs,
      makeJob('alta-3', {
        total: 22,
        opinion: { verdict: 'alta', possibility: 'alta', codes: [], unverified: [], outdated: false },
      }),
    ],
    [],
    now,
    now,
  );
  assert.deepEqual(
    crowded.top.map((item) => item.key),
    ['alta-hi', 'alta-3', 'media-1', 'media-2'],
  );

  // When media is empty, up to 4 alta postings fill top.
  const altaOnly = summarizeLavoro(
    [1, 2, 3, 4, 5].map((n) =>
      makeJob(`only-alta-${n}`, {
        total: 30 - n,
        opinion: { verdict: 'alta', possibility: 'alta', codes: [], unverified: [], outdated: false },
      }),
    ),
    [],
    now,
    now,
  );
  assert.deepEqual(
    altaOnly.top.map((item) => item.key),
    ['only-alta-1', 'only-alta-2', 'only-alta-3', 'only-alta-4'],
  );
});

void test('backlog: only active applications count toward interviewsThisWeek, pending, and interviewing', () => {
  const inTwoDays = now + 2 * DAY_MS;
  const jobs: JobRow[] = [
    makeJob('app-pending', {
      application: { appliedAt: now - 5 * DAY_MS, status: 'pending', closedAt: null, reason: null, notes: null },
    }),
    makeJob('app-interviewing', {
      application: {
        appliedAt: now - 10 * DAY_MS,
        status: 'interviewing',
        closedAt: null,
        reason: null,
        notes: null,
        interviews: [{ id: 1, key: 'app-interviewing', scheduledAt: inTwoDays, label: 'Tecnico' }],
      },
    }),
    makeJob('app-rejected', {
      application: {
        appliedAt: now - 10 * DAY_MS,
        status: 'rejected',
        closedAt: now - DAY_MS,
        reason: 'no',
        notes: null,
        interviews: [{ id: 2, key: 'app-rejected', scheduledAt: inTwoDays, label: 'Scartato ma in agenda' }],
      },
    }),
    makeJob('app-withdrawn', {
      application: {
        appliedAt: now - 10 * DAY_MS,
        status: 'withdrawn',
        closedAt: now - DAY_MS,
        reason: null,
        notes: null,
        interviews: [{ id: 3, key: 'app-withdrawn', scheduledAt: inTwoDays, label: 'Ritirata' }],
      },
    }),
    makeJob('app-expired-saved', {
      application: {
        appliedAt: now - 30 * DAY_MS,
        status: 'expired',
        closedAt: now - 5 * DAY_MS,
        reason: null,
        notes: null,
        interviews: [{ id: 4, key: 'app-expired-saved', scheduledAt: inTwoDays, label: 'Vecchio' }],
      },
    }),
    // Pending 25 days old with no interviews is effectively expired -> closed, not pending.
    makeJob('app-ghosted', {
      application: { appliedAt: now - 25 * DAY_MS, status: 'pending', closedAt: null, reason: null, notes: null },
    }),
  ];

  const summary = summarizeLavoro(jobs, [], now, null);
  assert.equal(summary.pending, 1);
  assert.equal(summary.interviewing, 1);
  assert.equal(summary.interviewsThisWeek, 1);
  assert.equal(summary.lastCollectionAt, null);
});
