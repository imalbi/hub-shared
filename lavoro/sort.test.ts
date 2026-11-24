import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobRow } from './server.ts';
import { groupJobs, sortJobs } from './sort.ts';

const j1: JobRow = {
  key: '1',
  comparisonKey: '1',
  title: 'Zeta Engineer',
  company: 'Beta Srl',
  location: 'Milano',
  site: 'indeed',
  url: 'https://example.com/1',
  applyUrl: null,
  score: 8,
  total: 8,
  reasons: [],
  categories: [],
  description: null,
  descriptionHtml: null,
  workMode: 'remote',
  isRemote: true,
  detailsMissing: false,
  postedAt: 1000,
  firstSeen: 1000,
  importedAt: null,
  blacklistRule: null,
  archivedAt: null,
  deletedAt: null,
  application: null,
  companyApplications: [],
  opinion: null,
};

const j2: JobRow = {
  ...j1,
  key: '2',
  title: 'Alpha Developer',
  company: 'Acme Corp',
  total: 12,
  firstSeen: 2000,
};

const j3: JobRow = {
  ...j1,
  key: '3',
  title: 'Beta Designer',
  company: 'Beta Srl',
  total: 8,
  firstSeen: 3000,
};

void test('sortJobs sorts by score descending, ties broken by firstSeen descending', () => {
  const sorted = sortJobs([j1, j2, j3], 'score');
  // j2 has total 12, j1 and j3 both have total 8; j3 has firstSeen 3000 > j1 1000
  assert.deepEqual(
    sorted.map((j) => j.key),
    ['2', '3', '1'],
  );
});

void test('sortJobs sorts by newest (firstSeen / postedAt descending)', () => {
  const sorted = sortJobs([j1, j2, j3], 'newest');
  assert.deepEqual(
    sorted.map((j) => j.key),
    ['3', '2', '1'],
  );
});

void test('sortJobs sorts by company A-Z, ties broken by firstSeen descending', () => {
  const sorted = sortJobs([j1, j2, j3], 'company');
  // Acme Corp (j2), Beta Srl (j3 firstSeen 3000, j1 firstSeen 1000)
  assert.deepEqual(
    sorted.map((j) => j.key),
    ['2', '3', '1'],
  );
});

void test('sortJobs sorts by title A-Z, ties broken by firstSeen descending', () => {
  const sorted = sortJobs([j1, j2, j3], 'title');
  // Alpha Developer (j2), Beta Designer (j3), Zeta Engineer (j1)
  assert.deepEqual(
    sorted.map((j) => j.key),
    ['2', '3', '1'],
  );
});

const opinion = (possibility: 'alta' | 'media' | 'bassa' | 'fuori') => ({
  verdict: possibility,
  possibility,
  codes: [],
  unverified: [],
  outdated: false,
});
const o1: JobRow = { ...j1, key: 'fuori30', total: 30, opinion: opinion('fuori') };
const o2: JobRow = { ...j1, key: 'media5', total: 5, opinion: opinion('media') };
const o3: JobRow = { ...j1, key: 'alta9-old', total: 9, firstSeen: 1, opinion: opinion('alta') };
const o4: JobRow = { ...j1, key: 'alta9-new', total: 9, firstSeen: 9, opinion: opinion('alta') };
const o5: JobRow = { ...j1, key: 'none20', total: 20, opinion: null };
const o6: JobRow = { ...j1, key: 'media8', total: 8, opinion: opinion('media') };
const o8: JobRow = { ...j1, key: 'bassa30', total: 30, opinion: opinion('bassa') };
const o9: JobRow = { ...j1, key: 'bassa3', total: 3, opinion: opinion('bassa') };
const applied = { title: 'Altro', appliedAt: 1, status: 'pending' } as const;
const o7: JobRow = { ...j1, key: 'fuori99-gia', total: 99, opinion: opinion('fuori'), companyApplications: [applied] };
const o10: JobRow = { ...j1, key: 'media12-gia', total: 12, opinion: opinion('media'), companyApplications: [applied] };

void test('P4 sortJobs by opinion: alta, media, none, bassa, fuori; Interesse orders inside a group, never across', () => {
  const sorted = sortJobs([o1, o2, o3, o4, o5, o6, o9, o8], 'opinion');
  assert.deepEqual(
    sorted.map((j) => j.key),
    ['alta9-new', 'alta9-old', 'media8', 'media5', 'none20', 'bassa30', 'bassa3', 'fuori30'],
  );
});

void test('groupJobs keeps postings with companyApplications inside their opinion group and drops empty groups', () => {
  const groups = groupJobs(sortJobs([o1, o2, o5, o7, o8, o10], 'opinion'));
  assert.deepEqual(
    groups.map((g) => [g.id, g.jobs.map((j) => j.key)]),
    [
      ['media', ['media12-gia', 'media5']],
      ['senza', ['none20']],
      ['bassa', ['bassa30']],
      ['fuori', ['fuori99-gia', 'fuori30']],
    ],
  );
});
