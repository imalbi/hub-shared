import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calendarItemsOf } from './calendar-items.ts';

void test('an interview keeps its local time and a deadline only its day, both as work items', () => {
  const at = new Date(2026, 10, 19, 10, 0).getTime();
  const items = calendarItemsOf({
    interviews: [{ id: 1, key: 'iren:1', at, label: 'Colloquio, Torino' }],
    deadlines: [{ id: 7, day: '2026-11-17', ask: 'Inviare i documenti', sender: 'carla@example.org' }],
  });
  assert.deepEqual(
    items.map(({ day, time, kind, title }) => [day, time, kind, title]),
    [
      ['2026-11-19', '10:00', 'work', 'Colloquio, Torino'],
      ['2026-11-17', undefined, 'work', 'Inviare i documenti'],
    ],
  );
  assert.equal(items[1]?.origin, 'da carla@example.org');
});
