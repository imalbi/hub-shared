import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailIsOn } from './mail-on.ts';

void test('mail counts as on until its first answer, then only with accounts', () => {
  assert.equal(mailIsOn({ data: undefined, isPending: true, errorUpdateCount: 0 }), true);
  assert.equal(mailIsOn({ data: { accounts: [] }, isPending: false, errorUpdateCount: 0 }), true);
  assert.equal(mailIsOn({ data: null, isPending: false, errorUpdateCount: 0 }), false);
  assert.equal(mailIsOn({ data: undefined, isPending: false, errorUpdateCount: 1 }), false);
});

void test('a refetch after a failure does not flash Messaggi into the rail', () => {
  // TanStack puts a failed query with no data back to `pending` while it refetches (another page mounted it).
  assert.equal(mailIsOn({ data: undefined, isPending: true, errorUpdateCount: 1 }), false);
});
