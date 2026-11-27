import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BlacklistRule } from './blacklist.ts';
import type { JobRow } from './server.ts';
import { tabOf, type UserState } from './tabs.ts';

const baseJob: JobRow = {
  key: 'acme|dev',
  comparisonKey: 'acme|dev',
  title: 'Web Developer',
  company: 'Acme Corp',
  location: 'Exampleville',
  site: 'indeed',
  url: 'https://indeed.example/jobs/1',
  applyUrl: null,
  score: 10,
  total: 10,
  reasons: [],
  categories: ['Frontend'],
  description: 'Building web apps',
  descriptionHtml: null,
  workMode: 'remote',
  isRemote: true,
  detailsMissing: false,
  hasCv: false,
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

void test('tabOf default view is review (Da valutare)', () => {
  assert.equal(tabOf(baseJob), 'review');
});

void test('precedence: application > trash > blacklist > archive > review', () => {
  const jobWithRule: JobRow = { ...baseJob, blacklistRule: 1 };
  const allState: UserState = {
    applications: new Set([baseJob.key]),
    trash: new Set([baseJob.key]),
    archive: new Set([baseJob.key]),
  };

  // Application beats trash, blacklist and archive
  assert.equal(tabOf(jobWithRule, allState), 'applications');

  // Trash beats blacklist and archive
  const trashState: UserState = {
    trash: new Set([baseJob.key]),
    archive: new Set([baseJob.key]),
  };
  assert.equal(tabOf(jobWithRule, trashState), 'trash');

  // Blacklist beats archive
  const archiveState: UserState = {
    archive: new Set([baseJob.key]),
  };
  assert.equal(tabOf(jobWithRule, archiveState), 'blacklisted');

  // Archive beats review
  assert.equal(tabOf(baseJob, archiveState), 'archive');
});

void test('blacklist rule beats archive when active rule matches', () => {
  const archiveState: UserState = { archive: new Set([baseJob.key]) };
  const rules: BlacklistRule[] = [{ id: 7, enabled: true, field: 'company', matchType: 'equals', value: 'Acme Corp' }];
  assert.equal(tabOf(baseJob, archiveState, rules), 'blacklisted');
});

void test('disabled rule in rules is ignored', () => {
  const rules: BlacklistRule[] = [{ id: 7, enabled: false, field: 'company', matchType: 'equals', value: 'Acme Corp' }];
  assert.equal(tabOf(baseJob, undefined, rules), 'review');
});

void test('saved blacklistRule on posting is kept even after rule is deleted from rules list', () => {
  const jobWithRule: JobRow = { ...baseJob, blacklistRule: 99 };
  assert.equal(tabOf(jobWithRule, undefined, []), 'blacklisted');
});

void test('row-level state feeds tabOf without userState', () => {
  const appliedJob: JobRow = {
    ...baseJob,
    application: { appliedAt: 1000, status: 'pending', closedAt: null, reason: null, notes: null },
    deletedAt: 900,
    archivedAt: 800,
  };
  assert.equal(tabOf(appliedJob), 'applications');

  const trashJob: JobRow = { ...baseJob, deletedAt: 900, archivedAt: 800, blacklistRule: 1 };
  assert.equal(tabOf(trashJob), 'trash');

  const archivedJob: JobRow = { ...baseJob, archivedAt: 800 };
  assert.equal(tabOf(archivedJob), 'archive');
});

void test('tabOf routes protected category positions to blacklisted', () => {
  const protectedTitleJob: JobRow = {
    ...baseJob,
    title: 'Jr Angular Developer – Posizione riservata a categorie protette (L.68/99)',
  };
  assert.equal(tabOf(protectedTitleJob), 'blacklisted');

  const protectedDescJob: JobRow = {
    ...baseJob,
    description: 'Costituisce requisito obbligatorio: appartenenza alle categorie protette L. 68/99.',
  };
  assert.equal(tabOf(protectedDescJob), 'blacklisted');

  const standardJobWithDisclaimer: JobRow = {
    ...baseJob,
    description:
      'Reply promuove diversita e inclusione indipendentemente da caratteristiche tutelate dalla Legge Italiana (L.68/99).',
  };
  assert.equal(tabOf(standardJobWithDisclaimer), 'review');
});
