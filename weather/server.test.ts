import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { buildServer } from '../../apps/server/src/server.ts';

void test('weather without a location makes no request and has no value', async (t) => {
  let requests = 0;
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots: [fileURLToPath(new URL('../', import.meta.url))],
    onlyModules: ['weather'],
    deps: {
      fetch: async () => {
        requests++;
        throw new Error('unexpected');
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/trpc/weather.state' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().result.data, { configured: false, current: null });
  assert.equal(requests, 0);
});

void test('weather reports a configured location when its first request fails', async (t) => {
  const app = buildServer({
    dbPath: ':memory:',
    moduleRoots: [fileURLToPath(new URL('../', import.meta.url))],
    onlyModules: ['weather'],
    config: { ...emptyConfig, modules: { weather: { name: 'Esempio', latitude: 1, longitude: 2 } } },
    deps: {
      fetch: async () => {
        throw new Error('offline');
      },
    },
  });
  t.after(() => app.close());
  const response = await app.inject({ method: 'GET', url: '/trpc/weather.state' });
  assert.deepEqual(response.json().result.data, { configured: true, current: null });
});
