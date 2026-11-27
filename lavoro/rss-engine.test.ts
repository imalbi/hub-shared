import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHarness, rows, testProfile } from './harness.ts';
import { createFakeSource, makeCard } from './fake-source.ts';
import { feed, rss } from './fake-rss.ts';
import { context, input } from './list-source-test.ts';
import { createRssSource } from './rss.ts';
import { requestUrl } from './test-http.ts';
void test('RSS keeps healthy feed cards when another feed fails and never exposes bodies', async () => {
  const ctx = context(
    async (request) =>
      requestUrl(request).includes('/broken') ? new Response('private body', { status: 500 }) : new Response(rss()),
    { rss: { feeds: [{ ...feed, url: 'https://feeds.example.org/broken' }, feed] } },
  );
  const result = await createRssSource().search(input, ctx);
  assert.equal(result.cards.length, 1);
  assert.equal(result.complete, false);
  assert.equal(result.error?.message, 'rss: HTTP 500');
  assert.ok(ctx.now() >= 1000);
});
void test('RSS caps leave a listing incomplete and invalid feed targets make no requests', async () => {
  const capped = await createRssSource().search(
    input,
    context(
      async () => new Response(rss().replace('</channel>', rss(2).match(/<item>.*<\/item>/su)?.[0] + '</channel>')),
      { rss: { feeds: [feed], maxItems: 1 } },
    ),
  );
  assert.equal(capped.cards.length, 1);
  assert.equal(capped.complete, false);
  let calls = 0;
  const ctx = context(async () => {
    calls++;
    return new Response(rss());
  });
  if (!ctx.limits.rss) throw new Error('missing fixture');
  ctx.limits.rss.feeds[0] = { ...feed, url: 'https://127.0.0.1/jobs' };
  const result = await createRssSource().search(input, ctx);
  assert.equal(result.complete, false);
  assert.equal(calls, 0);
});

void test('RSS matching a prior source uses the existing comparison key without another job', async () => {
  const profile = testProfile((p) => {
    p.search.sites = ['indeed', 'rss'];
    p.filter.allowedLocations = ['exampleville'];
  });
  const h = createHarness({
    profile,
    fetch: async () => new Response(rss(1, 'bad date')),
    sources: [
      createFakeSource({
        catalog: () => [
          makeCard('indeed', 1, {
            company: 'Example',
            title: 'Frontend developer',
            location: 'Exampleville',
            description: 'TypeScript e Docker',
          }),
        ],
      }),
      createRssSource(),
    ],
  });
  await h.collect();
  assert.equal(rows(h.db).length, 1);
});
