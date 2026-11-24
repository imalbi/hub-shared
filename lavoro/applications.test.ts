import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import {
  effectiveApplicationStatus,
  EXPIRY_DAYS,
  EXPIRY_MS,
  isActive,
  isApplicationExpired,
  type ApplicationLike,
} from './applications.ts';

void describe('applications expiry rule', () => {
  const baseTime = 1_700_000_000_000;

  void test('boundary: exactly 21 days is not expired, 21 days + 1 ms is expired', () => {
    const app = {
      status: 'pending' as const,
      appliedAt: baseTime,
      interviews: [],
    };

    // Exactly 21 days
    assert.equal(isApplicationExpired(app, baseTime + EXPIRY_MS), false);
    assert.equal(effectiveApplicationStatus(app, baseTime + EXPIRY_MS), 'pending');

    // 21 days - 1 ms
    assert.equal(isApplicationExpired(app, baseTime + EXPIRY_MS - 1), false);
    assert.equal(effectiveApplicationStatus(app, baseTime + EXPIRY_MS - 1), 'pending');

    // 21 days + 1 ms: strictly more than 21 days
    assert.equal(isApplicationExpired(app, baseTime + EXPIRY_MS + 1), true);
    assert.equal(effectiveApplicationStatus(app, baseTime + EXPIRY_MS + 1), 'expired');
  });

  void test('latest interview controls expiry and manual outcomes win', () => {
    const now = baseTime + 60 * 86_400_000;
    const interview = (days: number) => ({ scheduledAt: now - days * 86_400_000 });
    const app: ApplicationLike = { status: 'pending', appliedAt: baseTime, interviews: [interview(22)] };
    assert.equal(effectiveApplicationStatus(app, now), 'expired');
    assert.equal(effectiveApplicationStatus({ ...app, status: 'interviewing' }, now), 'expired');
    assert.equal(effectiveApplicationStatus({ ...app, interviews: [interview(20)] }, now), 'pending');
    assert.equal(effectiveApplicationStatus({ ...app, interviews: [interview(22), interview(-1)] }, now), 'pending');
    assert.equal(effectiveApplicationStatus({ ...app, status: 'rejected' }, now), 'rejected');
  });

  void test('application with status other than pending preserves original status', () => {
    const sixtyDaysLater = baseTime + 60 * 24 * 60 * 60 * 1000;

    const statuses = ['interviewing', 'offer', 'rejected', 'withdrawn', 'expired'] as const;
    for (const status of statuses) {
      const app = {
        status,
        appliedAt: baseTime,
        interviews: [],
      };
      assert.equal(isApplicationExpired(app, sixtyDaysLater), false);
      assert.equal(effectiveApplicationStatus(app, sixtyDaysLater), status);
    }
  });

  void test('constant checks', () => {
    assert.equal(EXPIRY_DAYS, 21);
    assert.equal(EXPIRY_MS, 21 * 24 * 60 * 60 * 1000);
  });
});

void test('only pending, interviewing and offer are active', () => {
  for (const status of ['pending', 'interviewing', 'offer']) assert.equal(isActive(status), true);
  for (const status of ['rejected', 'withdrawn', 'expired', 'unknown']) assert.equal(isActive(status), false);
});
