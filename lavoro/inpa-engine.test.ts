import assert from 'node:assert/strict';
import { test } from 'node:test';
import { item, ok, page, serveInpa } from './fake-inpa.ts';
import { capturingLog, createHarness, rows, testProfile } from './harness.ts';
import { createInpaSource } from './inpa.ts';

// The real inPA source inside the real engine, on the virtual clock, with a fetch that serves invented answers. The
// source's own rules are in `inpa.test.ts`.

const profile = testProfile((p) => {
  p.search.sites = ['inpa'];
  p.search.queries = [{ name: 'Web', keywords: 'ignored', indeedTerms: [] }];
  Object.assign(p, { stable: { sites: ['inpa'], titleWeights: { operatore: 2 } } });
});

const catalog = () =>
  page(
    [
      item(1, { entiRiferimento: ['ARPA'] }),
      item(2, { entiRiferimento: ['ARPA'], descrizione: '<p>Requisiti: laurea obbligatoria in giurisprudenza.</p>' }),
      item(3, { entiRiferimento: ['ARPA'], sedi: ['Nazionale'], figuraRicercata: 'Operatore nazionale' }),
      item(4, { entiRiferimento: ['ARPA'], figuraRicercata: 'Archivista' }),
      item(5, { entiRiferimento: ['ARPA'], sedi: ['Otherland', 'Otherville'] }),
    ],
    true,
  );

void test('inPA postings are Stabile end to end: a diploma one is saved, a degree one is dropped and counted', async () => {
  const { log, records } = capturingLog();
  const served = serveInpa([ok(catalog())]);
  const h = createHarness({ sources: [createInpaSource()], fetch: served.fetch, profile, log });
  const { requirements } = await h.collect();
  const saved = rows(h.db);
  assert.deepEqual(saved.map((row) => row.title).toSorted(), ['Operatore 1', 'Operatore nazionale']);
  for (const row of saved) {
    assert.deepEqual(row.categories, ['Stabile']);
    assert.ok(row.reasons.includes('stabile:fonte'));
    assert.equal(row.site, 'inpa');
  }
  assert.deepEqual(requirements, { laurea: 1 });
  const counted = records.find((record) => record.message === 'Lavoro search ingested');
  assert.deepEqual(counted?.fields, {
    site: 'inpa',
    read: 5,
    fresh: 5,
    known: 0,
    tooOld: 0,
    outsideLocation: 1,
    lowTitle: 0,
    excludedRequirement: 1,
    listed: 2,
    excluded: 0,
  });
});

void test('a national competition passes the location filter, one in another place does not', async () => {
  const h = createHarness({ sources: [createInpaSource()], fetch: serveInpa([ok(catalog())]).fetch, profile });
  await h.collect();
  const byTitle = new Map(rows(h.db).map((row) => [row.title, row]));
  assert.equal(byTitle.get('Operatore nazionale')?.location, 'Italy');
  assert.equal(byTitle.has('Operatore 5'), false);
});

void test('a competition whose role hits no title weight stays out, though inPA makes it Stabile', async () => {
  const h = createHarness({ sources: [createInpaSource()], fetch: serveInpa([ok(catalog())]).fetch, profile });
  await h.collect();
  assert.equal(
    rows(h.db).some((row) => row.title === 'Archivista'),
    false,
  );
});

void test('a dry run reads the region once and writes nothing', async () => {
  const served = serveInpa([ok(catalog())]);
  const h = createHarness({ sources: [createInpaSource()], fetch: served.fetch, profile });
  const { status, dryRun } = await h.collect('prova');
  assert.equal(status, 'done');
  assert.equal(served.requests.length, 1);
  assert.equal(dryRun.length, 2);
  assert.equal(rows(h.db).length, 0);
});

void test('town location excludes a distant Comune while the regional body still passes', async () => {
  const localProfile = testProfile((p) => {
    p.search.sites = ['inpa'];
    p.search.queries = [{ name: 'Web', keywords: 'ignored', indeedTerms: [] }];
    p.filter.allowedLocations = ['Torino'];
    Object.assign(p, { stable: { sites: ['inpa'], titleWeights: { operatore: 2 } } });
  });
  const served = serveInpa([
    ok(
      page(
        [
          item(1, { entiRiferimento: ['Comune di Prarostino'], sedi: ['Piemonte', 'Torino'] }),
          item(2, { entiRiferimento: ['ARPA Piemonte'], sedi: ['Piemonte', 'Torino'] }),
        ],
        true,
      ),
    ),
  ]);
  const { log, records } = capturingLog();
  const h = createHarness({ sources: [createInpaSource()], fetch: served.fetch, profile: localProfile, log });
  await h.collect();
  assert.deepEqual(
    rows(h.db).map((row) => row.company),
    ['ARPA Piemonte'],
  );
  const fields = records.find((record) => record.message === 'Lavoro search ingested')?.fields;
  assert.ok(typeof fields === 'object' && fields !== null && 'outsideLocation' in fields);
  assert.equal(fields.outsideLocation, 1);
});
