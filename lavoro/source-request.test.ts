import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRssSource } from './rss.ts';
import { createAltamiraSource } from './altamira.ts';
import { createSmatSource } from './smat.ts';
import { rss } from './fake-rss.ts';
import { listing as altamira } from './fake-altamira.ts';
import { listing as smat } from './fake-smat.ts';
import { context, input } from './list-source-test.ts';
import { MAX_SCRAPER_BYTES } from './bounded-fetch.ts';
for (const [source, body] of [
  [createRssSource(), rss()],
  [createAltamiraSource(), altamira([])],
  [createSmatSource(), smat(true)],
] as const) {
  void test(`${source.name} honors Retry-After, limits retries and reports bounded safe errors`, async () => {
    let calls = 0;
    const waits: Array<number | null> = [];
    const ctx = context(async () =>
      ++calls === 1 ? new Response('private', { status: 429, headers: { 'retry-after': '5' } }) : new Response(body),
    );
    ctx.reportWait = (_site, wait) => {
      waits.push(wait);
    };
    const result = await source.search(input, ctx);
    assert.equal(result.complete, true);
    assert.equal(calls, 2);
    assert.deepEqual(waits, [5, null]);
    assert.equal(ctx.now(), 5000);
    for (const oversized of [
      new Response('private', { headers: { 'content-length': String(MAX_SCRAPER_BYTES + 1) } }),
      new Response('x'.repeat(MAX_SCRAPER_BYTES + 1)),
    ]) {
      const capped = await source.search(
        input,
        context(async () => oversized),
      );
      assert.equal(capped.complete, false);
      assert.equal(capped.error?.message, `${source.name}: request failed`);
    }
    let retries = 0;
    const limited = await source.search(
      input,
      context(async () => {
        retries++;
        return new Response('private', { status: 429, headers: { 'retry-after': '1' } });
      }),
    );
    assert.equal(retries, 3);
    assert.equal(limited.error?.message, `${source.name}: HTTP 429`);
    const tooLong = await source.search(
      input,
      context(async () => new Response('private', { status: 429, headers: { 'retry-after': '121' } })),
    );
    assert.equal(tooLong.complete, false);
  });
}
