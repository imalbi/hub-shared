import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { buildServer } from '../../apps/server/src/server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';

void test('state exposes the results of injected site checks', async (t) => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    return new Response(null, { status: url.endsWith('/down') ? 503 : 200 });
  };
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots: [fileURLToPath(new URL('../', import.meta.url))],
    onlyModules: ['sites'],
    deps: { run: createFakeDesktop(), fetch: fetcher },
    config: {
      ...emptyConfig,
      modules: {
        sites: [
          { name: 'Primo', url: 'https://example.com/up' },
          { name: 'Secondo', url: 'https://example.com/down' },
        ],
      },
    },
  });
  t.after(() => app.close());
  const configured = await app.inject({ method: 'GET', url: '/trpc/sites.configured' });
  assert.deepEqual(configured.json(), { result: { data: true } });
  const response = await app.inject({ method: 'GET', url: '/trpc/sites.state' });
  assert.equal(response.statusCode, 200);
  const result: unknown = response.json();
  assert.ok(result && typeof result === 'object' && 'result' in result);
  const output = JSON.stringify(result);
  assert.match(output, /Primo/);
  assert.match(output, /Secondo/);
  assert.match(output, /503/);
  assert.deepEqual(urls.toSorted(), ['https://example.com/down', 'https://example.com/up']);
});

void test('a paired phone learns whether Siti is on, never a name or an address', async (t) => {
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots: [fileURLToPath(new URL('../', import.meta.url))],
    onlyModules: ['sites'],
    deps: { run: createFakeDesktop(), fetch: async () => new Response(null, { status: 200 }) },
    config: { ...emptyConfig, modules: { sites: [{ name: 'Invented', url: 'https://example.com/up' }] } },
  });
  t.after(() => app.close());
  const code = (await app.inject({ method: 'POST', url: '/trpc/pairing.createCode', payload: {} })).json().result.data
    .code;
  const LAN = '192.0.2.31';
  const pair = await app.inject({
    method: 'POST',
    url: '/trpc/pairing.redeem',
    remoteAddress: LAN,
    payload: { code, deviceName: 'Phone' },
  });
  const headers = { authorization: `Bearer ${pair.json().result.data.token}` };
  const configured = await app.inject({ url: '/trpc/sites.configured', remoteAddress: LAN, headers });
  assert.deepEqual(configured.json(), { result: { data: true } });
  for (const path of ['sites.state']) {
    const denied = await app.inject({ url: `/trpc/${path}`, remoteAddress: LAN, headers });
    assert.equal(denied.statusCode, 403, path);
    assert.ok(!/Invented|example\.com/.test(denied.body));
  }
  assert.equal((await app.inject('/trpc/sites.state')).statusCode, 200);
});
