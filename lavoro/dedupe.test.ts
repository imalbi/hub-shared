import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planDuplicates, type DedupeRow } from './dedupe.ts';

const row = (key: string, company: string, title: string, over: Partial<DedupeRow> = {}): DedupeRow => ({
  key,
  company,
  title,
  location: '',
  score: 10,
  hasDescription: false,
  applied: false,
  firstSeen: 1,
  blacklisted: false,
  ...over,
});

void test('one row is kept per posting: the applied one, then the one with a description', () => {
  const plan = planDuplicates([
    row('a', 'Iren', 'Addetto/a junior manutenzione'),
    row('b', 'Iren Spa', 'Addetto junior manutenzione', { hasDescription: true }),
    row('c', 'Iren tramite Synergie', 'Manutenzione junior addetto', { applied: true }),
  ]);
  assert.deepEqual(
    plan.hide.map((h) => [h.key, h.keptKey]).toSorted((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
    [
      ['a', 'c'],
      ['b', 'c'],
    ],
  );
  assert.match(plan.hide[0]?.note ?? '', /^Duplicato di Iren tramite Synergie/);
});

void test('applied rows are never hidden and rows already blacklisted are ignored', () => {
  const plan = planDuplicates([
    row('a', 'Acme', 'Dev', { applied: true }),
    row('b', 'Acme srl', 'Dev', { applied: true }),
    row('c', 'Acme', 'dev', { blacklisted: true }),
  ]);
  assert.deepEqual(plan.hide, []);
});
