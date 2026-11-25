import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studyCalendarItems } from './calendar-days.ts';

const day = (key: string, done = false, doneAt: string | null = null) => ({
  key,
  title: key,
  subject: 'p:chem',
  done,
  doneAt,
});
const copy = { open: 'Studio', done: 'Studio, fatto', subject: () => 'Chimica' };
const month = { from: '2026-11-01', to: '2026-11-30' };
const placed = (items: ReturnType<typeof studyCalendarItems>) =>
  items.map((item) => [item.title, item.day, item.label]);

void test('a done day stays where it was done; open days slide one a day from today, the current first', () => {
  const index = {
    current: 'p/C05',
    days: [day('p/C03', true, new Date(2026, 10, 12, 18).toISOString()), day('p/C04'), day('p/C05'), day('p/C06')],
    hiddenDays: [day('p/X01', true, new Date(2026, 10, 3, 9).toISOString())],
  };
  assert.deepEqual(placed(studyCalendarItems(index, '2026-11-15', month, copy)), [
    ['p/C03', '2026-11-12', 'Studio, fatto'],
    ['p/X01', '2026-11-03', 'Studio, fatto'],
    ['p/C05', '2026-11-15', 'Studio'],
    ['p/C04', '2026-11-16', 'Studio'],
    ['p/C06', '2026-11-17', 'Studio'],
  ]);
  // Tomorrow the same open days have slid by one.
  assert.deepEqual(placed(studyCalendarItems(index, '2026-11-16', month, copy)).slice(2), [
    ['p/C05', '2026-11-16', 'Studio'],
    ['p/C04', '2026-11-17', 'Studio'],
    ['p/C06', '2026-11-18', 'Studio'],
  ]);
});

void test('a day done today keeps today, so the open ones start tomorrow; outside the range nothing shows', () => {
  const index = {
    current: null,
    days: [day('p/C01', true, new Date(2026, 10, 15, 11).toISOString()), day('p/C02'), day('p/C03', true)],
    hiddenDays: [],
  };
  // A done day with no recorded time (done before doneAt existed) has no place.
  assert.deepEqual(placed(studyCalendarItems(index, '2026-11-15', month, copy)), [
    ['p/C01', '2026-11-15', 'Studio, fatto'],
    ['p/C02', '2026-11-16', 'Studio'],
  ]);
  assert.deepEqual(studyCalendarItems(index, '2026-11-15', { from: '2026-10-01', to: '2026-10-31' }, copy), []);
});
