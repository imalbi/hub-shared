import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mailSender, mailTime, recentMail, summarizeMail } from './summary.ts';

void test('unread totals preserve the window limit and do not hide a failed account', () => {
  assert.deepEqual(
    summarizeMail([
      { unread: 2, capped: true },
      { unread: 1, capped: false },
    ]),
    {
      count: 3,
      capped: true,
    },
  );
  assert.deepEqual(
    summarizeMail([
      { unread: 2, capped: false },
      { unread: null, capped: false },
    ]),
    {
      count: null,
      capped: false,
    },
  );
});

void test('recentMail merges accounts newest-first and formats sender and time safely', () => {
  const rows = recentMail(
    [
      {
        account: 'work',
        latest: [
          { id: '1', date: '2026-11-05T15:00:00Z' },
          { id: '2', date: '2026-11-07T09:00:00Z' },
        ],
      },
      {
        account: 'personal',
        latest: [
          { id: '3', date: '2026-11-06T18:00:00Z' },
          { id: '4', date: null },
        ],
      },
    ],
    3,
  );
  assert.deepEqual(
    rows.map(({ account, id }) => `${account}:${id}`),
    ['work:2', 'personal:3', 'work:1'],
  );

  assert.equal(mailSender({ name: 'Recruiter Example', email: 'r@example.org' }), 'Recruiter Example');
  assert.equal(mailSender({ name: null, email: 'news@example.org' }), 'news@example.org');
  assert.equal(mailSender(null), '');

  const localSample = new Date(2026, 10, 7, 18, 3);
  const expected = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' }).format(localSample);
  assert.equal(mailTime(localSample.toISOString()), expected);
  assert.equal(mailTime(null), '');
  assert.equal(mailTime('not-a-date'), '');
});
