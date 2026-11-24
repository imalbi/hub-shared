import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { algoliaPage, bootstrapHtml, hit } from './fake-synergie.ts';
import { parseAlgoliaConfig, readPage } from './synergie.ts';

void test('parseAlgoliaConfig reads bootstrap credentials and fails cleanly on changed layout', () => {
  const cfg = parseAlgoliaConfig(bootstrapHtml('APP123', 'fixturekey999999', 'apps_idx'));
  assert.deepEqual(cfg, { appId: 'APP123', apiKey: 'fixturekey999999', indexName: 'apps_idx' });
  assert.throws(() => parseAlgoliaConfig('<html><body>no config</body></html>'), /synergie: the search layout changed/);
});

void test('readPage filters archived hits, deduplicates location, cleans HTML and keeps metadata lines', () => {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  const page = readPage(
    algoliaPage([
      hit(1, {
        city: 'Torino',
        county: 'Torino',
        region: 'Piemonte',
        remuneration: '25k',
      }),
      hit(2, { archived: '1' }),
      hit(3, {
        sourceUrl: null,
        linkKey: 'ruolo-senza-url-3',
        company: null,
        contract: null,
        area: null,
      }),
    ]),
    cleaner,
  );
  assert.equal(page.nbPages, 1);
  assert.equal(page.rows.length, 2);

  const first = page.rows[0]?.card;
  assert.equal(first?.location, 'Torino, Piemonte');
  assert.equal(first?.company, 'Synergie Italia S.p.a.');
  assert.match(first?.description ?? '', /^Contratto: Tempo indeterminato\nArea: ICT\nRetribuzione: 25k/u);
  assert.match(first?.description ?? '', /Attività tecniche\nDiploma tecnico/u);
  assert.doesNotMatch(first?.description ?? '', /hidden/u);
  assert.ok(first?.postedAt instanceof Date);

  const second = page.rows[1]?.card;
  assert.equal(second?.url, 'https://www.synergie-italia.it/candidato/offerte-di-lavoro/ruolo-senza-url-3');
  assert.equal(second?.company, 'Synergie');
});

void test('readPage skips Gruppo Iren, IRETI and IRENfutura reposts without false-matching substrings', () => {
  const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
  const page = readPage(
    algoliaPage([
      hit(1, { title: 'Tecnico reti', positionHtml: '<p>Cliente: Gruppo Iren</p>' }),
      hit(2, { title: 'Addetto manutenzione', requirementsHtml: '<p>Società ireti spa</p>' }),
      hit(3, { title: 'Offerta IRENFUTURA tecnico', positionHtml: '<p>Descrizione</p>' }),
      hit(4, { title: 'Tecnico sirena Firenze', positionHtml: '<p>Sede a Firenze per sistemi sirena</p>' }),
    ]),
    cleaner,
  );
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0]?.id, '4');
});
