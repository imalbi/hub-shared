import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readUmana, readUmanaDetail } from './umana.ts';
import { agencyDescription } from './agency.ts';
import { listing, detail } from './fake-umana.ts';

const read = (raw: string) =>
  readUmana(raw, 'https://www.umana.it/per-le-persone/offerte-di-lavoro/ict/', ['examplia'], ['ex']);
void test('umana AG3 extracts exact fields, cleans description and recognizes empty listings', () => {
  const card = read(listing()).cards[0];
  assert.ok(card);
  assert.equal(card.url, 'https://www.umana.it/per-le-persone/offerte-di-lavoro/esempio/1/');
  assert.equal(card.title, 'Frontend developer 1');
  assert.equal(card.site, 'umana');
  assert.equal(card.company, 'Umana');
  assert.equal(card.location, 'EX, Examplia');
  assert.equal(card.contract, 'Tempo indeterminato');
  assert.equal(card.salary, '€ 28000-30000 annuale');
  const enriched = readUmanaDetail(card, detail('<p>TypeScript <b>richiesto</b></p><script>BAD</script>'));
  assert.equal(enriched.postedAt?.toISOString(), '2026-11-27T00:00:00.000Z');
  assert.equal(enriched.contract, 'Tempo indeterminato');
  assert.equal(enriched.salary, '€ 28000-30000 annuale');
  const formatted = agencyDescription(enriched.contract, enriched.salary, enriched.descriptionHtml ?? '');
  assert.match(formatted.description, /^Contratto: Tempo indeterminato · Retribuzione: € 28000-30000 annuale/u);
  assert.match(formatted.description, /TypeScript richiesto/u);
  assert.doesNotMatch(formatted.description, /BAD|PRIVACY|HIDDEN/u);
  assert.deepEqual(read(listing([])).cards, []);
});
void test('umana rejects unknown listing layouts', () => {
  assert.throws(() => read('<html>Unexpected layout</html>'));
});

void test('Umana filters explicit geography and preserves salary thousands separators', () => {
  assert.deepEqual(
    readUmana(listing(), 'https://www.umana.it/per-le-persone/offerte-di-lavoro/ict/', ['elsewhere'], ['ex']).cards,
    [],
  );
  const card = read(listing().replace('28000-30000', '28.000-30.000')).cards[0];
  assert.equal(card?.salary, '€ 28.000-30.000 annuale');
});
