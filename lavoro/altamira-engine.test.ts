import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detail, employer, listing } from './fake-altamira.ts';
import { createAltamiraSource } from './altamira.ts';
import { context, input } from './list-source-test.ts';
import { requestUrl } from './test-http.ts';
void test('Altamira skips known details, cleans new details and keeps failed details incomplete with paced requests', async () => {
  const times: number[] = [];
  const urls: string[] = [];
  const ctx = context(async (request) => {
    const url = requestUrl(request);
    urls.push(url);
    times.push(ctx.now());
    return url === employer.listUrl
      ? new Response(listing([1, 2, 3]))
      : url.endsWith('3.htm')
        ? new Response('private', { status: 500 })
        : new Response(detail);
  });
  ctx.isKnown = (url) => url.endsWith('1.htm');
  const result = await createAltamiraSource().search(input, ctx);
  assert.equal(urls.length, 3);
  assert.ok(!urls.some((url) => url.endsWith('1.htm')));
  assert.deepEqual(times, [0, 1000, 2000]);
  assert.equal(result.cards[1]?.descriptionHtml, '<p>TypeScript e Docker</p>');
  assert.equal(result.cards[2]?.detailsMissing, true);
  assert.equal(result.complete, true);
});
void test('Altamira follows links, marks caps incomplete, preserves partial results on later list failure', async () => {
  const run = (maxPages: number, fail = false) => {
    const ctx = context(
      async (request) =>
        new Response(
          requestUrl(request).includes('?page=2') ? (fail ? 'private' : listing([2])) : listing([1], '?page=2'),
          { status: fail && requestUrl(request).includes('?page=2') ? 500 : 200 },
        ),
      { altamira: { employers: [employer], maxPages } },
    );
    ctx.isKnown = () => true;
    return createAltamiraSource().search(input, ctx);
  };
  assert.equal((await run(1)).complete, false);
  assert.equal((await run(2)).cards.length, 2);
  const failed = await run(2, true);
  assert.equal(failed.cards.length, 1);
  assert.equal(failed.complete, false);
});
