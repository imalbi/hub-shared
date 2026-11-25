import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { effectiveMix, estimate, orderDays } from './order.ts';

void test('mix preserves done positions, subject order and shares', () => {
  const days = Array.from({ length: 20 }, (_, i) => ({
    id: `d${i}`,
    subject: i % 2 ? 'b' : 'a',
    minutes: 60,
    done: i === 2,
  }));
  assert.deepEqual(
    orderDays(days, {}, null).map((d) => d.id),
    days.map((d) => d.id),
  );
  const ordered = orderDays(days, {}, { a: 60, b: 40 });
  assert.equal(ordered[2]?.id, 'd2');
  const open = ordered.filter((day) => !day.done);
  for (let i = 1; i <= 12; i++) {
    const count = open.slice(0, i).filter((day) => day.subject === 'a').length;
    assert.ok(Math.abs(count - i * 0.6) <= 1);
  }
  assert.deepEqual(
    orderDays(days, { b: 'paused' }, null).map((d) => d.id),
    orderDays(days, {}, { a: 100, b: 0 }).map((d) => d.id),
  );
});

void test('weekly share and remaining estimate use minutes', () => {
  assert.deepEqual(estimate(1860, 60, 12), { hoursPerWeek: 7.2, hoursRemaining: 31, weeksRemaining: 31 / 7.2 });
  assert.equal(estimate(60, 0, 12).weeksRemaining, null);
});

void test('60/40 keeps every prefix within one day when enough work remains', () => {
  const days = Array.from({ length: 30 }, (_, i) => ({
    id: `day-${i}`,
    subject: i < 18 ? 'a' : 'b',
    minutes: 60,
    done: false,
  }));
  const ordered = orderDays(days, {}, { a: 60, b: 40 });
  for (let length = 1; length <= ordered.length; length++) {
    const prefix = ordered.slice(0, length);
    const actual = prefix.filter((day) => day.subject === 'a').reduce((sum, day) => sum + day.minutes, 0);
    assert.ok(Math.abs(actual - length * 60 * 0.6) <= 60, `prefix ${length}`);
  }
});

void test('pausing redistributes the share and resuming restores the mix', () => {
  const mix = { a: 60, b: 40 };
  assert.deepEqual(effectiveMix(mix, { b: 'paused' }), { a: 100, b: 0 });
  assert.deepEqual(effectiveMix(mix, {}), mix);
});
