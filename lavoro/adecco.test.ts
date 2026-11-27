import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAdecco, adeccoRequest, readAdeccoDetail } from './adecco.ts';
import { agencyDescription } from './agency.ts';
import { listing, detail } from './fake-adecco.ts';

const read = (raw: string) => readAdecco(raw, adeccoRequest('exampleville', 'ict'), 'exampleville');
void test('adecco AG3 extracts exact fields, cleans description and recognizes empty listings', () => {
  const card = read(listing()).cards[0];
  assert.ok(card);
  assert.equal(card.url, 'https://www.adecco.com/it-it/offerte-lavoro?jobId=1');
  assert.equal(card.title, 'Frontend developer 1');
  assert.equal(card.site, 'adecco');
  assert.equal(card.company, 'Adecco');
  assert.equal(card.location, 'Exampleville, Examplia');
  assert.equal(card.contract, 'Tempo indeterminato');
  assert.equal(card.salary, '€ 28000-30000 annuale');
  const enriched = readAdeccoDetail(card, detail('<p>TypeScript <b>richiesto</b></p><script>BAD</script>'));
  assert.equal(enriched.postedAt?.toISOString(), '2026-11-27T10:00:00.000Z');
  const formatted = agencyDescription(enriched.contract, enriched.salary, enriched.descriptionHtml ?? '');
  assert.match(formatted.description, /TypeScript richiesto/u);
  assert.doesNotMatch(formatted.description, /BAD|PRIVACY|HIDDEN/u);
  assert.deepEqual(read(listing([])).cards, []);
});
void test('adecco rejects unknown listing layouts', () => {
  assert.throws(() => read('<html>Unexpected layout</html>'));
});

void test('Adecco filters explicit city and only uses an explicitly named client', () => {
  assert.deepEqual(readAdecco(listing(), adeccoRequest('elsewhere', 'ict'), 'elsewhere').cards, []);
  const card = read(listing()).cards[0];
  assert.ok(card);
  assert.equal(
    readAdeccoDetail(card, JSON.stringify({ jobDescription: '<p>Ruolo</p>', companyName: 'Officina Esempio' })).company,
    'Officina Esempio',
  );
});
