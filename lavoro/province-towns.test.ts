import assert from 'node:assert/strict';
import { test } from 'node:test';
import { provinceTowns } from './province-towns.ts';

void test('P4 the ISTAT map includes all 312 TO towns and the Samone homonym', () => {
  assert.equal(Object.values(provinceTowns).filter((provinces) => provinces.includes('TO')).length, 312);
  assert.deepEqual(provinceTowns.samone?.toSorted(), ['TN', 'TO']);
});
