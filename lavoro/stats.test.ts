import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applicationStats, firstResponse, type StatsRow } from './stats.ts';
import { possibilityOf } from './opinion-prompt.ts';
import type { ApplicationStatus } from './schema.ts';

const now = Date.UTC(2026, 10, 14);
const day = 86_400_000;
const row = (
  key: string,
  site: string,
  status: ApplicationStatus | null,
  extra: { ageDays?: number; interviews?: number; verdict?: string } = {},
): StatsRow => ({
  key,
  site,
  application: status && {
    status,
    appliedAt: now - (extra.ageDays ?? 2) * day,
    interviews: Array.from({ length: extra.interviews ?? 0 }, () => ({ scheduledAt: now })),
  },
  opinion: extra.verdict ? { possibility: extra.verdict } : null,
});

// An answer stored before prompt version 7 counts as alta through the mapping; the others are new values.
const oldAlta = possibilityOf({ verdict: 'candidati', codes: [] });

// A fixture database: 9 postings, 8 applied to.
const rows: StatsRow[] = [
  row('a', 'linkedin', 'pending'),
  row('b', 'linkedin', 'pending', { ageDays: 30 }),
  row('c', 'linkedin', 'interviewing', { interviews: 1, verdict: oldAlta }),
  row('d', 'indeed', 'offer', { interviews: 2, verdict: oldAlta }),
  row('e', 'indeed', 'rejected', { verdict: 'media' }),
  row('f', 'indeed', 'expired', { ageDays: 50, verdict: oldAlta }),
  row('g', 'inpa', 'withdrawn'),
  row('h', 'inpa', 'pending', { interviews: 1 }),
  {
    ...row('j', 'inpa', 'pending'),
    application: { status: 'pending', appliedAt: now - 40 * day, interviews: [{ scheduledAt: now - 22 * day }] },
  },
  row('i', 'inpa', null, { verdict: oldAlta }),
];

void test('L2 totals: sent, replies, interviews, offers, rejections and ghosting (every expired)', () => {
  const stats = applicationStats(rows, now);
  assert.deepEqual(stats.total, {
    sent: 9,
    // c, d, h, j (interviews), e (rejection)
    replied: 5,
    interviews: 4,
    offers: 1,
    rejections: 1,
    // b by the 21-day rule, f saved by hand
    ghosted: 3,
    ghostedAfterInterview: 1,
  });
});

void test('L2 the same numbers by source, and the sources add up to the totals', () => {
  const stats = applicationStats(rows, now);
  assert.deepEqual(
    stats.bySource.map(({ site, sent, replied, interviews, offers, rejections, ghosted }) => ({
      site,
      sent,
      replied,
      interviews,
      offers,
      rejections,
      ghosted,
    })),
    [
      { site: 'indeed', sent: 3, replied: 2, interviews: 1, offers: 1, rejections: 1, ghosted: 1 },
      { site: 'inpa', sent: 3, replied: 2, interviews: 2, offers: 0, rejections: 0, ghosted: 1 },
      { site: 'linkedin', sent: 3, replied: 1, interviews: 1, offers: 0, rejections: 0, ghosted: 1 },
    ],
  );
  for (const key of ['sent', 'replied', 'interviews', 'offers', 'rejections', 'ghosted'] as const)
    assert.equal(
      stats.bySource.reduce((sum, entry) => sum + entry[key], 0),
      stats.total[key],
    );
});

void test('L2 Parere verdicts against outcomes: judged counts every posting, outcomes only the applied ones', () => {
  const stats = applicationStats(rows, now);
  const alta = stats.byVerdict.find((entry) => entry.possibility === 'alta');
  assert.deepEqual(alta, {
    possibility: 'alta',
    judged: 4,
    sent: 3,
    replied: 2,
    interviews: 2,
    offers: 1,
    rejections: 0,
    ghosted: 1,
    ghostedAfterInterview: 0,
  });
  assert.equal(stats.byVerdict.find((entry) => entry.possibility === 'media')?.rejections, 1);
  assert.deepEqual(
    stats.byVerdict.map((entry) => entry.possibility),
    ['alta', 'media'],
  );
});

void test('L2 no applications gives zeros and no rows', () => {
  const stats = applicationStats([row('x', 'inpa', null)], now);
  assert.equal(stats.total.sent, 0);
  assert.deepEqual(stats.bySource, []);
});

void test('linked inbox mail alone does not count as a reply', () => {
  const linkedInbox = { ...row('linked', 'site', 'pending'), thread: { messages: [{ mailbox: 'inbox' }] } };
  assert.equal(applicationStats([linkedInbox], now).total.replied, 0);
});

void test('P4 first response: median days, with the count it rests on', () => {
  const apps = ['a', 'b', 'c'].map((key) => ({ key, appliedAt: now - 20 * day }));
  const at = (days: number) => now - 20 * day + days * day;
  // Odd count: the middle one. Only the first answer of an application counts.
  assert.deepEqual(
    firstResponse(apps, [
      { key: 'a', at: at(2) },
      { key: 'a', at: at(9) },
      { key: 'b', at: at(4) },
      { key: 'c', at: at(10) },
    ]),
    { medianDays: 4, count: 3 },
  );
  // Even count: the two in the middle.
  assert.deepEqual(
    firstResponse(apps, [
      { key: 'a', at: at(2) },
      { key: 'b', at: at(5) },
    ]),
    { medianDays: 3.5, count: 2 },
  );
});

void test('P4 first response: no answer gives no value, and an answer before the application is ignored', () => {
  const apps = [{ key: 'a', appliedAt: now }];
  assert.equal(firstResponse(apps, []), null);
  assert.equal(firstResponse(apps, [{ key: 'other', at: now + day }]), null);
  assert.equal(firstResponse(apps, [{ key: 'a', at: now - day }]), null);
});

void test('displayName maps known source and opinion ids and leaves an unknown one as it is', async () => {
  const { copy } = await import('./copy.ts');
  const { displayName } = await import('./stats.ts');
  assert.equal(displayName(copy.stats.sources, 'reteinformaticalavoro'), 'Rete Informatica Lavoro');
  assert.equal(displayName(copy.stats.sources, 'sito'), "Sito dell'azienda");
  assert.equal(displayName(copy.stats.opinions, 'media'), 'Possibilità media');
  assert.equal(displayName(copy.stats.opinions, 'fuori'), 'Fuori dai vincoli');
  assert.equal(displayName(copy.stats.sources, 'mystery'), 'mystery');
});
