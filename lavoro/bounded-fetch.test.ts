import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchBounded, MAX_SCRAPER_BYTES, readBoundedJson, readBoundedText, sameSiteHost } from './bounded-fetch.ts';

void test('sameSiteHost permits same-site subdomains and blocks third-party or local hosts', () => {
  assert.equal(sameSiteHost('www.linkedin.com', 'it.linkedin.com'), true);
  assert.equal(sameSiteHost('jobs.enel.com', 'jobs.enel.com'), true);
  assert.equal(sameSiteHost('jobs.enel.com', 'evil.example'), false);
  assert.equal(sameSiteHost('jobs.enel.com', 'router.lan'), false); // guard-private: allow Synthetic security test value
  assert.equal(sameSiteHost('jobs.enel.com', '10.0.0.1'), false); // guard-private: allow Synthetic security test value
});

void test('fetchBounded follows same-site redirects and refuses off-site or private redirects without fetching target', async () => {
  const seen: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);
    if (url === 'https://jobs.example.org/start') {
      return new Response(null, { status: 302, headers: { location: 'https://careers.example.org/final' } });
    }
    if (url === 'https://careers.example.org/final') {
      return new Response('<html>ok</html>', { status: 200 });
    }
    if (url === 'https://jobs.example.org/to-private') {
      return new Response(null, { status: 302, headers: { location: 'http://10.0.0.1/admin' } }); // guard-private: allow Synthetic security test value
    }
    if (url === 'https://jobs.example.org/to-external') {
      return new Response(null, { status: 302, headers: { location: 'https://attacker.example/steal' } });
    }
    return new Response('nope', { status: 404 });
  };

  const okRes = await fetchBounded(fakeFetch, 'https://jobs.example.org/start');
  assert.equal(await readBoundedText(okRes), '<html>ok</html>');

  await assert.rejects(fetchBounded(fakeFetch, 'https://jobs.example.org/to-private'), /refused/);
  await assert.rejects(fetchBounded(fakeFetch, 'https://jobs.example.org/to-external'), /refused/);
  assert.ok(!seen.includes('http://10.0.0.1/admin')); // guard-private: allow Synthetic security test value
  assert.ok(!seen.includes('https://attacker.example/steal'));
});

void test('readBoundedText and readBoundedJson stop reading streamed bodies past 4 MiB cap', async () => {
  let chunksProduced = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksProduced++;
      if (chunksProduced > 10) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
  });

  await assert.rejects(readBoundedText(new Response(stream), MAX_SCRAPER_BYTES), /size cap/);
  assert.ok(chunksProduced <= 6, `stream kept reading too many chunks: ${chunksProduced}`);

  await assert.rejects(
    readBoundedJson(new Response('too-big', { headers: { 'content-length': String(10 * 1024 * 1024) } })),
    /size cap/,
  );
});
