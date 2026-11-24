import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatState } from './print-dry-run.ts';

// Invented states in the shape `lavoro.state` returns (see `LavoroState` in server.ts).
const row = (n: number, patch: Record<string, unknown> = {}) => ({
  title: `Frontend developer ${n}`,
  company: `Company ${n}`,
  location: 'Exampleville, EX, Italy',
  site: 'indeed',
  url: `https://indeed.example/viewjob?jk=${n}`,
  score: 7,
  total: 10.5,
  reasons: ['frontend:+3', 'typescript:+2 (descr.)'],
  categories: [],
  workMode: 'remote',
  ...patch,
});
const ready = (patch: Record<string, unknown> = {}) => ({
  status: 'ready',
  queries: 1,
  sources: ['indeed'],
  collection: null,
  last: { kind: 'prova', finishedAt: Date.UTC(2026, 10, 5, 12, 30), status: 'done', newCount: 2, excludedCount: 1 },
  dryRun: [row(1), row(2, { score: 5, total: 5, workMode: null, reasons: [] })],
  dryRunRequirements: null,
  ...patch,
});

void test('a dry run is a table, best first as the server sent it: totals, score, title, company, place, mode, reasons', () => {
  const lines = formatState(ready()).split('\n');
  assert.match(lines[0] ?? '', /^Last run: prova, done, .*2 new, 1 excluded by rules$/);
  const header = lines.find((line) => line.includes('total'));
  assert.match(header ?? '', /^\s*total\s+score\s+title\s+company\s+location\s+mode\s+reasons$/);
  const first = lines.find((line) => line.includes('Frontend developer 1'));
  assert.match(
    first ?? '',
    /^\s*10\.5\s+7\.0\s+Frontend developer 1\s+Company 1\s+Exampleville, EX, Italy\s+remote\s+frontend:\+3, typescript:\+2 \(descr\.\)$/,
  );
  const second = lines.find((line) => line.includes('Frontend developer 2'));
  assert.match(second ?? '', /^\s*5\.0\s+5\.0\s+Frontend developer 2\s+Company 2\s+Exampleville, EX, Italy\s+-\s*$/);
  assert.equal(lines.filter((line) => line.includes('Frontend developer')).length, 2);
});

void test('long fields are cut so a row stays one line', () => {
  const text = formatState(ready({ dryRun: [row(1, { title: 'T'.repeat(200), company: 'C'.repeat(200) })] }));
  assert.ok(text.split('\n').every((line) => line.length < 220));
  assert.ok(text.includes('...'));
});

void test('with no dry run in memory it says how to make one, and starts nothing', () => {
  const text = formatState(ready({ dryRun: null }));
  assert.match(text, /No dry run in memory/);
  assert.match(text, /Prova raccolta/);
  assert.match(formatState(ready({ dryRun: [] })), /listed nothing/);
});

void test('a running collection is reported with its progress', () => {
  const collection = { kind: 'prova', searchesDone: 2, searchesTotal: 9, newCount: 4, excludedCount: 0 };
  assert.match(formatState(ready({ collection, dryRun: null })), /prova is running: 2 of 9 searches, 4 found so far/);
});

void test('an invalid profile lists the keys that are wrong, never values', () => {
  const text = formatState({
    status: 'invalid-config',
    issues: [{ path: 'sources.indeed', message: 'required when indeed is in search.sites' }],
  });
  assert.match(text, /profile is invalid/);
  assert.match(text, /sources\.indeed: required when indeed is in search\.sites/);
});

void test('an answer of another shape is reported as such, with nothing of it printed', () => {
  const text = formatState({ status: 'ready', secret: 'TOP-SECRET', dryRun: 5 });
  assert.match(text, /Unexpected answer/);
  assert.ok(!text.includes('TOP-SECRET'));
  assert.match(formatState(undefined), /Unexpected answer/);
});

void test('postings dropped for what they require are summed per reason, also when nothing was listed', () => {
  const text = formatState(ready({ dryRunRequirements: { laurea: 3, patente: 1 } }));
  assert.ok(text.split('\n').includes('Dropped by requirement: laurea 3, patente 1'));
  const empty = formatState(ready({ dryRun: [], dryRunRequirements: { sanitario: 2 } }));
  assert.match(empty, /Dropped by requirement: sanitario 2\nThe last dry run listed nothing/);
  assert.doesNotMatch(formatState(ready({ dryRunRequirements: {} })), /Dropped by requirement/);
});
