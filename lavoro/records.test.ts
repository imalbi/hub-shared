import assert from 'node:assert/strict';
import { test } from 'node:test';
import { searchApplications, searchPostings } from './records.ts';
import type { JobRow } from './server.ts';

const base: JobRow = {
  key: 'k',
  comparisonKey: 'k',
  title: 'Sviluppatore',
  company: 'Acme',
  location: 'Torino',
  site: 'indeed',
  url: 'https://jobs.example/1',
  applyUrl: null,
  score: 10,
  total: 10,
  reasons: [],
  categories: [],
  description: null,
  descriptionHtml: null,
  workMode: null,
  isRemote: false,
  detailsMissing: false,
  hasCv: false,
  postedAt: null,
  firstSeen: 1000,
  importedAt: null,
  blacklistRule: null,
  archivedAt: null,
  deletedAt: null,
  application: null,
  companyApplications: [],
  opinion: null,
};
const job = (key: string, patch: Partial<JobRow>): JobRow => ({ ...base, key, comparisonKey: key, ...patch });
const DAY = 86_400_000;

const rows: JobRow[] = [
  job('a', { title: 'React Developer', total: 25 }),
  job('b', { title: 'Front-end (REACT)', company: 'Società Èlite', total: 9, archivedAt: 5 }),
  job('c', { title: 'Backend Java', company: 'Reactive Labs', total: 30 }),
  job('d', { title: 'Designer', total: 50 }),
  job('e', { title: 'react native', total: 12, deletedAt: 7 }),
  job('f', { title: 'Reactor technician', total: 11 }),
  job('g', {
    title: 'React Lead',
    application: {
      appliedAt: 3 * DAY,
      status: 'pending',
      closedAt: null,
      reason: null,
      notes: null,
      interviews: [],
      lastMail: null,
    },
  }),
  job('h', {
    title: 'Senior React',
    application: {
      appliedAt: 5 * DAY,
      status: 'rejected',
      closedAt: null,
      reason: null,
      notes: null,
      interviews: [],
      lastMail: null,
    },
  }),
];

void test('postings match title or company without case or accents, and exclude those with an application', () => {
  const found = searchPostings(rows, [], 'REACT');
  assert.equal(found.total, 5);
  // To review first, then by Annunci's order (no opinion here, so score), cut at 3: the full count stays 5. The deleted
  // `e` (score 12) falls behind `f` (11), which is still to review.
  assert.deepEqual(
    found.rows.map((row) => row.key),
    ['c', 'a', 'f'],
  );
  assert.deepEqual(
    searchPostings(rows, [], 'societa elite').rows.map((row) => [row.key, row.segment]),
    [['b', 'archive']],
  );
  assert.deepEqual(searchPostings(rows, [], 'senior').rows, []);
  assert.deepEqual(searchPostings(rows, [], '   '), { total: 0, rows: [] });
});

void test('every word must match, in the title or the company', () => {
  assert.deepEqual(
    searchPostings(rows, [], 'backend reactive').rows.map((row) => row.key),
    ['c'],
  );
  assert.equal(searchPostings(rows, [], 'backend designer').total, 0);
});

void test('a posting carries the tab it sits in, and the score and possibility as badges', () => {
  const withOpinion = job('o', {
    title: 'Opinion job',
    total: 33,
    deletedAt: 1,
    opinion: { verdict: 'media', possibility: 'media', codes: [], unverified: [], outdated: false },
  });
  assert.deepEqual(searchPostings([withOpinion], [], 'opinion').rows, [
    {
      key: 'o',
      title: 'Opinion job',
      company: 'Acme',
      location: 'Torino',
      segment: 'trash',
      score: 33,
      possibility: 'media',
    },
  ]);
  const rule = { id: 1, enabled: true, field: 'company' as const, matchType: 'equals' as const, value: 'Acme' };
  assert.equal(searchPostings([job('r', { title: 'Excluded' })], [rule], 'excluded').rows[0]?.segment, 'blacklisted');
});

void test('applications are the postings that have one, newest sent first, with the status the cards show', () => {
  const found = searchApplications(rows, 'react', 30 * DAY);
  assert.equal(found.total, 2);
  assert.deepEqual(
    found.rows.map((row) => [row.key, row.status, row.appliedAt]),
    [
      ['h', 'rejected', 5 * DAY],
      // Pending for more than 21 days with no interview reads as expired, like the card.
      ['g', 'expired', 3 * DAY],
    ],
  );
  assert.deepEqual(searchApplications(rows, 'designer', 30 * DAY), { total: 0, rows: [] });
});

void test('postings to review come before archived, excluded and deleted ones, whatever their opinion', () => {
  const opinion = (possibility: 'alta' | 'bassa'): JobRow['opinion'] => ({
    verdict: possibility,
    possibility,
    codes: [],
    unverified: [],
    outdated: false,
  });
  const found = searchPostings(
    [
      job('deleted', { title: 'React', opinion: opinion('alta'), deletedAt: 5 }),
      job('archived', { title: 'React', opinion: opinion('alta'), archivedAt: 5 }),
      job('review', { title: 'React', opinion: opinion('bassa') }),
    ],
    [],
    'react',
  );
  assert.deepEqual(
    found.rows.map((row) => row.key),
    ['review', 'archived', 'deleted'],
  );
});
