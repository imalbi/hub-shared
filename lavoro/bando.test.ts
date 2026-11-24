import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { test } from 'node:test';
import type { Run } from '../../apps/server/src/core/exec.ts';
import { readBando } from './bando.ts';
import { requestUrl } from './test-http.ts';

const url = 'https://www.inpa.gov.it/bandi-e-avvisi/dettaglio-bando-avviso/?concorso_id=123abc';

void test('inPA selects the first bando, extracts at most 20000 characters and removes the temporary file', async () => {
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const address = requestUrl(input);
    requests.push(address);
    if (requests.length === 1)
      return Response.json({
        allegati: [
          { tipo: 'BANDO_CONCORSO', sequence: 3, mediaId: 'later' },
          { tipo: 'ALTRI', sequence: 0, mediaId: 'other' },
          { tipo: 'BANDO_CONCORSO', sequence: 1, mediaId: 'first' },
        ],
      });
    return new Response('invented PDF bytes', { headers: { 'content-type': 'application/pdf' } });
  };
  let file = '';
  const run: Run = async (bin, args, options) => {
    assert.equal(bin, 'pdftotext');
    assert.deepEqual(args.slice(0, 4), ['-enc', 'UTF-8', '-l', '40']);
    assert.equal(args[5], '-');
    assert.equal(options?.timeoutMs, 20_000);
    file = args[4] ?? '';
    assert.equal(await readFile(file, 'utf8'), 'invented PDF bytes');
    return { stdout: 'x'.repeat(20_001), stderr: '', code: 0 };
  };
  assert.equal((await readBando(url, fetcher, run))?.length, 20_000);
  assert.ok(requests[0]?.endsWith('/123abc'));
  assert.ok(requests[1]?.endsWith('/first'));
  await assert.rejects(access(file));
});

void test('invalid input, no bando, non-PDF, oversized PDF and extraction failures are skipped', async () => {
  const run: Run = async () => ({ stdout: '', stderr: '', code: 1 });
  let calls = 0;
  const none: typeof fetch = async () => {
    calls++;
    return Response.json({ allegati: [] });
  };
  assert.equal(await readBando('not a URL', none, run), null);
  assert.equal(calls, 0);
  assert.equal(await readBando(url, none, run), null);
  for (const response of [
    new Response('x', { headers: { 'content-type': 'text/plain' } }),
    new Response('x', { headers: { 'content-type': 'application/pdf', 'content-length': '10485761' } }),
    new Response(new Uint8Array(10 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/pdf' } }),
    new Response('x', { headers: { 'content-type': 'application/pdf' } }),
  ]) {
    let request = 0;
    const fetcher: typeof fetch = async () =>
      ++request === 1
        ? Response.json({ allegati: [{ tipo: 'BANDO_CONCORSO', sequence: 1, mediaId: 'invented' }] })
        : response;
    assert.equal(await readBando(url, fetcher, run), null);
  }
  assert.equal(
    await readBando(
      url,
      async () => {
        throw new Error('invented failure');
      },
      run,
    ),
    null,
  );
});
