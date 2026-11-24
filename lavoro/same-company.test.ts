import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApplicationStatus } from './schema.ts';
import { sameCompanyApplications, withCompanyApplications } from './same-company.ts';

// Recent, so the 21-day expiry does not turn pending into expired.
const t = Date.now();

void test('matches normalized company, excludes own key and sorts every status newest first', () => {
  const jobs = [
    { key: 'a', company: 'Zucchetti S.p.A.', title: 'Backend' },
    { key: 'b', company: 'zucchetti', title: 'Frontend' },
    { key: 'c', company: 'ZUCCHETTI', title: 'Designer' },
    { key: 'd', company: 'Altro', title: 'Analyst' },
  ];
  const applications: { key: string; appliedAt: number; status: ApplicationStatus }[] = [
    { key: 'a', appliedAt: t + 1, status: 'pending' },
    { key: 'b', appliedAt: t + 3, status: 'rejected' },
    { key: 'c', appliedAt: t + 2, status: 'offer' },
  ];
  const result = sameCompanyApplications(jobs, applications);
  assert.deepEqual(result.get('a'), [
    { title: 'Frontend', appliedAt: t + 3, status: 'rejected' },
    { title: 'Designer', appliedAt: t + 2, status: 'offer' },
  ]);
  assert.deepEqual(result.get('b'), [
    { title: 'Designer', appliedAt: t + 2, status: 'offer' },
    { title: 'Backend', appliedAt: t + 1, status: 'pending' },
  ]);
  assert.deepEqual(result.get('d'), []);
});

void test('withCompanyApplications refreshes the other postings after an application changes', () => {
  const base = { company: 'Zucchetti', companyApplications: [] };
  const jobs = [
    { ...base, key: 'a', title: 'Backend', application: { appliedAt: t + 5, status: 'pending' as const } },
    { ...base, key: 'b', title: 'Frontend', application: null },
  ];
  const result = withCompanyApplications(jobs);
  assert.deepEqual(result[0]?.companyApplications, []);
  assert.deepEqual(result[1]?.companyApplications, [{ title: 'Backend', appliedAt: t + 5, status: 'pending' }]);
  assert.deepEqual(withCompanyApplications([{ ...jobs[0], application: null }, jobs[1]])[1]?.companyApplications, []);
});

void test('a pending application past the expiry window is listed as expired, one with interviews is not', () => {
  const old = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const jobs = [
    { key: 'a', company: 'Zucchetti', title: 'Backend' },
    { key: 'b', company: 'Zucchetti', title: 'Frontend' },
    { key: 'c', company: 'Zucchetti', title: 'Designer' },
  ];
  const result = sameCompanyApplications(jobs, [
    { key: 'a', appliedAt: old, status: 'pending' },
    { key: 'b', appliedAt: old - 1, status: 'pending', interviews: [{ scheduledAt: Date.now() }] },
  ]);
  assert.deepEqual(
    result.get('c')?.map((app) => app.status),
    ['expired', 'pending'],
  );
});
