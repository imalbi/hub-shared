import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mailDate } from './mail-date.ts';

void test('a mail date shows day, month and time; a missing or broken one shows nothing', () => {
  assert.match(mailDate('2026-11-07T09:00:00Z'), /^7 nov/);
  assert.equal(mailDate(null), '');
  assert.equal(mailDate('not a date'), '');
});
