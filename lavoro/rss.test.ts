import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atom, feed, rss } from './fake-rss.ts';
import { readFeed } from './rss.ts';
void test('RSS and Atom keep titles, public URLs, dates and cleaned full descriptions', () => {
  for (const xml of [rss(), atom]) {
    const [card] = readFeed(xml, feed);
    assert.equal(card?.title, 'Frontend developer');
    assert.equal(card?.company, 'Example');
    assert.equal(card?.descriptionHtml, '<p>TypeScript e Docker</p>');
    assert.equal(card?.description, 'TypeScript e Docker');
    assert.equal(card?.postedAt?.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(card?.detailsMissing, undefined);
  }
  assert.equal(readFeed(rss(1, 'bad date'), feed)[0]?.postedAt, undefined);
  assert.throws(() => readFeed('<html>unexpected</html>', feed), /layout changed/u);
  assert.throws(
    () => readFeed(rss().replace('https://jobs.example.org/role/1', 'https://127.0.0.1/role/1'), feed),
    /invalid public URL/u,
  );
  assert.deepEqual(readFeed('<rss><channel/></rss>', feed), []);
});

void test('truncated RSS cannot be mistaken for a complete empty listing', () => {
  assert.throws(() => readFeed('<rss><channel>', feed), /layout changed/u);
  assert.throws(() => readFeed(rss().replace('</channel></rss>', ''), feed), /layout changed/u);
});
