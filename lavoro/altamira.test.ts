import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { readAltamira } from './altamira.ts';
import { employer, listing } from './fake-altamira.ts';
void test('Altamira reads cards and distinguishes a valid empty table from a changed layout', () => {
  const read = (html: string) => readAltamira(parseHTML(html).document, employer.listUrl, employer.company);
  const result = read(listing());
  assert.equal(result.cards[0]?.title, 'Frontend developer 1');
  assert.equal(result.cards[0]?.location, 'Exampleville');
  assert.equal(result.cards[0]?.postedAt?.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(result.cards[0]?.url, 'https://board.example.org/annunci-lavoro/frontend-1.htm');
  assert.deepEqual(read(listing([])).cards, []);
  assert.throws(() => read('<html></html>'), /layout changed/u);
  assert.throws(
    () => read(listing().replace('/annunci-lavoro/frontend-1.htm', 'https://other.example.org/annunci-lavoro/1.htm')),
    /invalid posting URL/u,
  );
});
