import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearMultiChoiceFilters,
  computeFilterCounts,
  formatRelativeDate,
  matchesFilters,
  type LavoroFilters,
} from './filters.ts';
import type { JobRow } from './server.ts';

const base: JobRow = {
  key: 'k1',
  comparisonKey: 'k1',
  title: 'Dev 1',
  company: 'Alpha Inc',
  location: 'Milano',
  site: 'indeed',
  url: 'https://example.com/1',
  applyUrl: null,
  score: 8,
  total: 8,
  reasons: [],
  categories: ['Frontend'],
  description: null,
  descriptionHtml: null,
  workMode: 'remote',
  isRemote: true,
  detailsMissing: false,
  hasCv: false,
  postedAt: 1000,
  firstSeen: 1_700_000_000_000,
  importedAt: null,
  blacklistRule: null,
  archivedAt: null,
  deletedAt: null,
  application: null,
  companyApplications: [],
  opinion: null,
};

const job2: JobRow = {
  ...base,
  key: 'k2',
  company: 'Beta Corp',
  location: 'Torino',
  site: 'linkedin',
  score: 12,
  total: 12,
  categories: ['Backend'],
  workMode: 'hybrid',
  firstSeen: 1_700_000_000_000 - 48 * 3600 * 1000, // 2 days earlier
};

const job3: JobRow = {
  ...base,
  key: 'k3',
  company: 'Alpha Inc',
  location: 'Torino',
  site: 'reteinformaticalavoro',
  score: 5,
  total: 5,
  categories: ['Frontend', 'Fullstack'],
  workMode: 'onsite',
  firstSeen: 1_700_000_000_000 - 5 * 24 * 3600 * 1000, // 5 days earlier
};

void test('matchesFilters checks firstSeen, minScore, workMode, site, category, location, company', () => {
  const now = 1_700_000_000_000;

  // Min score filter
  assert.equal(matchesFilters(base, { minScore: 10 }, now), false);
  assert.equal(matchesFilters(job2, { minScore: 10 }, now), true);

  // Work mode filter
  assert.equal(matchesFilters(base, { workModes: ['hybrid'] }, now), false);
  assert.equal(matchesFilters(job2, { workModes: ['hybrid'] }, now), true);

  // Site filter
  assert.equal(matchesFilters(base, { sources: ['linkedin'] }, now), false);
  assert.equal(matchesFilters(job2, { sources: ['linkedin'] }, now), true);

  // Category filter
  assert.equal(matchesFilters(job3, { categories: ['Fullstack'] }, now), true);
  assert.equal(matchesFilters(base, { categories: ['Fullstack'] }, now), false);

  // First seen presets
  assert.equal(matchesFilters(base, { firstSeen: 'today' }, now), true);
  assert.equal(matchesFilters(job2, { firstSeen: 'today' }, now), false);
  assert.equal(matchesFilters(job2, { firstSeen: '3d' }, now), true);
  assert.equal(matchesFilters(job3, { firstSeen: '3d' }, now), false);
  assert.equal(matchesFilters(job3, { firstSeen: '7d' }, now), true);
});

void test('computeFilterCounts calculates remaining counts ignoring each filter itself', () => {
  const now = 1_700_000_000_000;
  const jobs = [base, job2, job3];

  // If workModes filter is active ('remote'), the workModes counts must still show hybrid: 1, onsite: 1!
  const filters: LavoroFilters = {
    workModes: ['remote'],
  };
  const counts = computeFilterCounts(jobs, filters, now);
  assert.equal(counts.workModes['remote'], 1);
  assert.equal(counts.workModes['hybrid'], 1);
  assert.equal(counts.workModes['onsite'], 1);

  // And for companies:
  assert.equal(counts.companies['Alpha Inc'], 1); // Only remote job matches other filters
  assert.equal(counts.companies['Beta Corp'], undefined);
});

void test('clearMultiChoiceFilters clears multi-choice but keeps search, dates and score', () => {
  const initial: LavoroFilters = {
    firstSeen: '7d',
    customFrom: 100,
    customTo: 200,
    minScore: 7,
    workModes: ['remote'],
    sources: ['indeed'],
    categories: ['Frontend'],
    locations: ['Milano'],
    companies: ['Alpha Inc'],
  };

  const cleared = clearMultiChoiceFilters(initial);
  assert.equal(cleared.firstSeen, '7d');
  assert.equal(cleared.customFrom, 100);
  assert.equal(cleared.customTo, 200);
  assert.equal(cleared.minScore, 7);
  assert.deepEqual(cleared.workModes, []);
  assert.deepEqual(cleared.sources, []);
  assert.deepEqual(cleared.categories, []);
  assert.deepEqual(cleared.locations, []);
  assert.deepEqual(cleared.companies, []);
});

void test('formatRelativeDate formats oggi HH:mm and N giorni fa', () => {
  // Let now be 2026-11-06T15:00:00Z
  const now = new Date('2026-11-06T15:00:00Z').getTime();

  // Same day at 14:30
  const sameDay = new Date('2026-11-06T14:30:00Z').getTime();
  assert.match(formatRelativeDate(sameDay, now), /^oggi\s+\d{2}:\d{2}$/);

  // Yesterday
  const yesterday = new Date('2026-11-05T14:30:00Z').getTime();
  assert.equal(formatRelativeDate(yesterday, now), 'ieri');

  // 3 days ago
  const threeDaysAgo = new Date('2026-11-03T10:00:00Z').getTime();
  assert.equal(formatRelativeDate(threeDaysAgo, now), '3 giorni fa');
});
