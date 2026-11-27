import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readGigroup } from './gigroup.ts';
import { agencyDescription, agencyJsonDetail } from './agency.ts';
import { listing, detail } from './fake-gigroup.ts';

const read = (raw: string) => readGigroup(raw, 'https://www.gigroup.it/offerte-lavoro/');
void test('gigroup AG3 extracts exact fields, cleans description and recognizes empty listings', () => {
  const card = read(listing()).cards[0];
  assert.ok(card);
  assert.equal(card.url, 'https://www.gigroup.it/offerte-lavoro-dettaglio/esempio/1/');
  assert.equal(card.title, 'Frontend developer 1');
  assert.equal(card.site, 'gigroup');
  assert.equal(card.company, 'Gi Group');
  assert.equal(card.location, 'Exampleville, EX, Examplia');
  assert.equal(card.contract, 'Contratto a tempo indeterminato - in azienda');
  assert.equal(card.salary, undefined);
  const enriched = agencyJsonDetail(card, detail('<p>TypeScript <b>richiesto</b></p><script>BAD</script>'));
  assert.equal(enriched.postedAt?.toISOString(), '2026-11-27T00:00:00.000Z');
  const formatted = agencyDescription(enriched.contract, enriched.salary, enriched.descriptionHtml ?? '');
  assert.match(formatted.description, /TypeScript richiesto/u);
  assert.doesNotMatch(formatted.description, /BAD|PRIVACY|HIDDEN/u);
  assert.deepEqual(read(listing([])).cards, []);
});
void test('gigroup rejects unknown listing layouts', () => {
  assert.throws(() => read('<html>Unexpected layout</html>'));
});
