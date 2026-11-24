import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closesInDays, daysSince } from './waiting.ts';

void test('closesInDays shows the last week of the 21-day rule and daysSince counts whole days', () => {
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 20, 12);
  const sent = (daysAgo: number, extra = {}) => ({
    status: 'pending' as const,
    appliedAt: now - daysAgo * day,
    ...extra,
  });
  assert.equal(closesInDays(sent(10), now), null);
  assert.equal(closesInDays(sent(13.5), now), null);
  assert.equal(closesInDays(sent(14), now), 7);
  assert.equal(closesInDays(sent(16), now), 5);
  assert.equal(closesInDays(sent(21), now), 1);
  assert.equal(closesInDays(sent(21.5), now), null);
  assert.equal(closesInDays(sent(16, { status: 'interviewing' }), now), null);
  assert.equal(closesInDays(sent(16, { interviews: [{ scheduledAt: now }] }), now), null);
  assert.equal(daysSince(now - 4 * day, now), 4);
  assert.equal(daysSince(now - 3.9 * day, now), 3);
  assert.equal(daysSince(now + day, now), 0);
});
