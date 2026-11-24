import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextFeed, type FeedCursor, type FetchPage } from './feed.ts';
import type { MailMessage } from './himalaya.ts';

const message = (id: string, day: number): MailMessage => ({
  id,
  messageId: null,
  subject: id,
  from: null,
  date: `2026-11-${String(day).padStart(2, '0')}T09:00:00Z`,
  seen: true,
  flagged: false,
  hasAttachment: null,
});

// Newest first, as himalaya lists them.
const boxes: Record<string, MailMessage[]> = {
  a: [message('a1', 20), message('a2', 18), message('a3', 16), message('a4', 14), message('a5', 12)],
  b: [message('b1', 19), message('b2', 9), message('b3', 8)],
};

function listing(size: number) {
  const calls: string[] = [];
  const fetchPage: FetchPage = (account, page) => {
    calls.push(`${account}:${page}`);
    return Promise.resolve({ ok: true, value: (boxes[account] ?? []).slice((page - 1) * size, page * size) });
  };
  return { calls, fetchPage };
}

async function walk(accounts: string[], size: number) {
  const { fetchPage } = listing(size);
  const ids: string[] = [];
  let cursor: FeedCursor | null = {};
  while (cursor) {
    const result = await nextFeed(accounts, cursor, size, fetchPage);
    assert.ok(result.ok);
    ids.push(...result.value.rows.map((row) => row.id));
    cursor = result.value.cursor;
  }
  return ids;
}

void test('two inboxes merge newest first across pages, each row once', async () => {
  assert.deepEqual(await walk(['a', 'b'], 3), ['a1', 'b1', 'a2', 'a3', 'a4', 'a5', 'b2', 'b3']);
});

void test('one account pages through its own listing in order', async () => {
  assert.deepEqual(await walk(['b'], 2), ['b1', 'b2', 'b3']);
});

void test('a row is held back while an account that has more pages could still hold a newer one', async () => {
  const { fetchPage } = listing(2);
  const first = await nextFeed(['a', 'b'], {}, 2, fetchPage);
  assert.ok(first.ok);
  // b's page ends at day 9 but a's at day 18: nothing older than 18 is safe until a is read further.
  assert.deepEqual(
    first.value.rows.map((row) => row.id),
    ['a1', 'b1'],
  );
  assert.deepEqual(first.value.cursor, { a: 1, b: 1 });
});

void test('a failed account fails the whole call', async () => {
  const result = await nextFeed(['a', 'b'], {}, 3, (account) =>
    Promise.resolve(account === 'b' ? { ok: false, failure: 'failed' } : { ok: true, value: [] }),
  );
  assert.deepEqual(result, { ok: false, failure: 'failed' });
});

void test('the end: no cursor once every account is read out', async () => {
  const { fetchPage } = listing(10);
  const result = await nextFeed(['b'], {}, 10, fetchPage);
  assert.ok(result.ok);
  assert.equal(result.value.cursor, null);
  assert.equal(result.value.rows.length, 3);
});

const dated = (id: string, day: number | null): MailMessage => ({
  ...message(id, day ?? 1),
  date: day === null ? null : `2026-11-${String(day).padStart(2, '0')}T09:00:00Z`,
});

async function walkBoxes(lists: Record<string, MailMessage[]>, size: number) {
  const accounts = Object.keys(lists);
  const fetchPage: FetchPage = (account, page) =>
    Promise.resolve({ ok: true, value: (lists[account] ?? []).slice((page - 1) * size, page * size) });
  const ids: string[] = [];
  let cursor: FeedCursor | null = {};
  for (let guard = 0; cursor && guard < 50; guard++) {
    const result = await nextFeed(accounts, cursor, size, fetchPage);
    assert.ok(result.ok);
    ids.push(...result.value.rows.map((row) => `${row.account}:${row.id}`));
    cursor = result.value.cursor;
  }
  return ids;
}

void test('an undated row and an out-of-order row keep every id once, in listing order (one account)', async () => {
  const a = [
    dated('m0', 20),
    dated('n2', null),
    dated('m1', 18),
    dated('m2', 17),
    dated('old', 5),
    dated('m3', 16),
    dated('m4', 15),
  ];
  assert.deepEqual(
    await walkBoxes({ a }, 3),
    a.map((row) => `a:${row.id}`),
  );
});

void test('an undated row and an out-of-order row lose nothing with two accounts', async () => {
  const a = [dated('a0', 20), dated('a1', null), dated('a2', 18), dated('a3', 5), dated('a4', 16), dated('a5', 15)];
  const b = [dated('b0', 19), dated('b1', 17), dated('b2', 14), dated('b3', 13)];
  const ids = await walkBoxes({ a, b }, 3);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate');
  assert.deepEqual(
    ids.filter((id) => id.startsWith('a:')),
    a.map((row) => `a:${row.id}`),
  );
  assert.deepEqual(
    ids.filter((id) => id.startsWith('b:')),
    b.map((row) => `b:${row.id}`),
  );
});
