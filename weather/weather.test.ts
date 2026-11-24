import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createWeather, searchLocations } from './weather.ts';

void test('retries after one minute when the first request fails', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const weather = createWeather(
    async () => {
      requests++;
      if (requests === 1) throw new Error('offline');
      return Response.json({
        current: { temperature_2m: 19, weather_code: 3 },
        daily: { temperature_2m_min: [12], temperature_2m_max: [23] },
      });
    },
    { name: 'Esempio', latitude: 1, longitude: 2 },
  );
  t.after(weather.close);
  assert.equal(await weather.read(), null);
  t.mock.timers.tick(59_999);
  assert.equal(requests, 1);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(requests, 2);
  assert.equal((await weather.read())?.temperature, 19);
});

void test('retries without a reading double up to 30 minutes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let requests = 0;
  const weather = createWeather(
    async () => {
      requests++;
      throw new Error('offline');
    },
    { name: 'Esempio', latitude: 1, longitude: 2 },
  );
  t.after(weather.close);
  await weather.read();
  for (const delay of [60, 120, 240, 480, 960, 1800, 1800]) {
    const before = requests;
    t.mock.timers.tick(delay * 1000 - 1);
    assert.equal(requests, before);
    t.mock.timers.tick(1);
    await setImmediate();
    assert.equal(requests, before + 1);
  }
});

void test('weather retains the last parsed forecast when a refresh fails', async () => {
  let fail = false;
  const fetcher: typeof fetch = async () => {
    if (fail) throw new Error('offline');
    return Response.json({
      current: { temperature_2m: 19, weather_code: 3 },
      daily: { temperature_2m_min: [12], temperature_2m_max: [23] },
    });
  };
  const weather = createWeather(fetcher, { name: 'Esempio', latitude: 1, longitude: 2 });
  await weather.refresh();
  assert.deepEqual(await weather.read(), { name: 'Esempio', temperature: 19, code: 3, min: 12, max: 23, stale: false });
  fail = true;
  await weather.refresh();
  assert.equal((await weather.read())?.stale, true);
  assert.equal((await weather.read())?.temperature, 19);
  weather.close();
});

void test('location search parses results without a network call', async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(
      new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).searchParams.get(
        'name',
      ),
      'Esempio',
    );
    return Response.json({ results: [{ name: 'Esempio', latitude: 1, longitude: 2, admin1: 'Regione' }] });
  };
  assert.deepEqual(await searchLocations(fetcher, 'Esempio'), [
    { name: 'Esempio', latitude: 1, longitude: 2, admin1: 'Regione' },
  ]);
});

void test('location search returns no results and propagates provider errors', async () => {
  assert.deepEqual(await searchLocations(async () => Response.json({}), 'Nessuno'), []);
  await assert.rejects(searchLocations(async () => new Response('', { status: 503 }), 'Errore'));
});
