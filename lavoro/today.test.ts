import assert from 'node:assert/strict';
import { test } from 'node:test';
import { todayParts, countInterviews } from './today.ts';

void test('today parts show counts in order and singular wording', () => {
  assert.deepEqual(
    todayParts(4, 2).map((part) => part.text),
    ['4 nuove da valutare', '2 colloqui questa settimana'],
  );
  assert.deepEqual(
    todayParts(1, 0).map((part) => part.text),
    ['1 nuova da valutare'],
  );
});

void test('zero parts are omitted and all zero gives no line', () => {
  assert.deepEqual(
    todayParts(0, 2).map((part) => part.text),
    ['2 colloqui questa settimana'],
  );
  assert.deepEqual(todayParts(0, 0), []);
});

void test('only interviews in the next seven days count', () => {
  const now = Date.UTC(2026, 10, 11);
  const day = 86_400_000;
  assert.equal(countInterviews([now - day, now + 2 * day, now + 8 * day], now), 1);
});
