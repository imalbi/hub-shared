import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readRandstad } from './randstad.ts';
import { agencyDescription, agencyJsonDetail } from './agency.ts';
import { listing, detail } from './fake-randstad.ts';

const read = (raw: string) => readRandstad(raw, 'https://www.randstad.it/offerte-lavoro/');
void test('randstad AG3 extracts exact fields, cleans description and recognizes empty listings', () => {
  const card = read(listing()).cards[0];
  assert.ok(card);
  assert.equal(card.url, 'https://www.randstad.it/offerte-lavoro/esempio_1/');
  assert.equal(card.title, 'Frontend developer 1');
  assert.equal(card.site, 'randstad');
  assert.equal(card.company, 'Randstad');
  assert.equal(card.location, 'Exampleville, Examplia');
  assert.equal(card.contract, 'Tempo indeterminato');
  assert.equal(card.salary, '€ 28000-30000 annuale');
  const enriched = agencyJsonDetail(card, detail('<p>TypeScript <b>richiesto</b></p><script>BAD</script>'));
  assert.equal(enriched.postedAt?.toISOString(), '2026-11-27T00:00:00.000Z');
  const formatted = agencyDescription(enriched.contract, enriched.salary, enriched.descriptionHtml ?? '');
  assert.match(formatted.description, /TypeScript richiesto/u);
  assert.doesNotMatch(formatted.description, /BAD|PRIVACY|HIDDEN/u);
  assert.deepEqual(read(listing([])).cards, []);
});
void test('randstad rejects unknown listing layouts', () => {
  assert.throws(() => read('<html>Unexpected layout</html>'));
});

void test('randstad accepts nullable optional sub-objects and skips non-JSON flight scripts', () => {
  const withNulls =
    listing([2])
      .replace(/\\"clientDetail\\":\{[^}]+\}/u, '\\"clientDetail\\":null')
      .replace(/\\"workLocationAddress\\":\{[^}]+\}/u, '\\"workLocationAddress\\":null')
      .replace(/\\"postingDetail\\":\{[^}]+\}/u, '\\"postingDetail\\":null')
      .replace(/\\"payRates\\":\{[^}]+\}/u, '\\"payRates\\":null') + '<script>self.__next_f.push(broken)</script>';
  const cards = read(withNulls).cards;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]?.company, 'Randstad');
  assert.equal(cards[0]?.location, '');
  assert.equal(cards[0]?.postedAt, undefined);
  assert.equal(cards[0]?.salary, undefined);
});
