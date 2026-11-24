import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import { probe, recordCheck, readSites } from './sites.ts';

void test('probe reports up, down, timeout and retries a refused HEAD with GET', async () => {
  assert.equal((await probe(async () => new Response(null, { status: 200 }), 'https://example.com')).status, 200);
  assert.equal((await probe(async () => new Response(null, { status: 503 }), 'https://example.com')).status, 503);
  const timeout: typeof fetch = async () => {
    throw new DOMException('Timeout', 'TimeoutError');
  };
  assert.equal((await probe(timeout, 'https://example.com')).error, 'timeout');
  const methods: string[] = [];
  const fallback: typeof fetch = async (_url, init) => {
    methods.push(init?.method ?? '');
    return new Response(null, { status: methods.length === 1 ? 405 : 200 });
  };
  assert.equal((await probe(fallback, 'https://example.com')).status, 200);
  assert.deepEqual(methods, ['HEAD', 'GET']);
});

void test('checks prune after 24 hours and daily totals prune after 90 days', () => {
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  try {
    const day = new Date(2026, 10, 1, 12).getTime();
    const add = (at: number, status: number) =>
      recordCheck(db, 'https://example.com', { at, status, latency: 30, error: null });
    add(day - 91 * 86_400_000, 200);
    add(day, 200);
    add(day + 5 * 60_000, 503);
    const [degraded] = readSites(db, [{ name: 'Esempio', url: 'https://example.com' }], day);
    assert.equal(degraded?.days.at(-1)?.status, 'degraded');
    assert.equal(degraded?.days.at(-1)?.minutes, 5);
    assert.equal(degraded?.uptime, 50);
    for (let i = 0; i < 5; i++) add(day + 5 * 60_000 * (i + 2), 503);
    add(day + 86_400_000, 200);
    const [site] = readSites(db, [{ name: 'Esempio', url: 'https://example.com' }], day + 86_400_000);
    assert.equal(site?.days.length, 90);
    assert.equal(site?.days.at(-2)?.status, 'major');
    assert.equal(site?.days.at(-2)?.minutes, 30);
    assert.equal(site?.days.at(-1)?.status, 'operational');
    assert.equal(site?.days.at(-3)?.status, 'none');
    assert.equal(site?.uptime, 25);
    assert.equal(db.$client.prepare('select count(*) as n from site_checks').get()?.n, 8);
    assert.equal(db.$client.prepare('select count(*) as n from site_days').get()?.n, 2);
  } finally {
    db.$client.close();
  }
});

void test('a request without an answer aborts after ten seconds', async () => {
  const fetcher: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing timeout signal');
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const started = Date.now();
  const check = await probe(fetcher, 'https://example.com');
  assert.equal(check.error, 'timeout');
  assert.ok(Date.now() - started >= 9_900);
});
