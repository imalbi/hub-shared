import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { item, ok, page, serveInpa } from './fake-inpa.ts';
import { capturingLog, silentLog, testProfile } from './harness.ts';
import { createInpaSource, placeOf, readItem, townOf } from './inpa.ts';
import type { SearchInput, SourceContext } from './source.ts';

// Everything here is invented; the answer's shape follows the 16n2 live check (field names and counts only).

const NOW = new Date(2026, 10, 9, 8).getTime();
const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
const API = 'https://portale.inpa.gov.it/concorsi-smart/api/concorso-public-area/search-better';

const input: SearchInput = {
  query: { name: 'Web', keywords: 'ignored', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};

function context(fetch: typeof globalThis.fetch, patch: Partial<SourceContext> = {}, inpa: object = {}) {
  const profile = testProfile((p) => {
    Object.assign(p.search, { inpa });
  });
  let now = NOW;
  const sleeps: number[] = [];
  const value: SourceContext = {
    signal: new AbortController().signal,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
    ...patch,
  };
  return { value, sleeps };
}

const source = createInpaSource();
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response('', { status: code, headers });

void test('an item becomes a card: short role as title, body as company, official title first in the text', () => {
  const card = readItem(
    item(7, {
      titolo: '  Concorso   pubblico per un posto di <b>operatore</b>  ',
      descrizione: '<p>Requisiti: <strong>diploma</strong>.</p><script>alert(1)</script><p onclick="x()">Fine</p>',
      dataPubblicazione: '2026-11-05T09:30:00Z',
    }),
    cleaner,
  );
  assert.deepEqual(card, {
    url: 'https://www.inpa.gov.it/bandi-e-avvisi/dettaglio-bando-avviso/?concorso_id=id0007',
    title: 'Operatore 7',
    company: 'Comune di Esempio 7',
    location: 'Esempio 7',
    site: 'inpa',
    description: 'Concorso pubblico per un posto di <b>operatore</b>\nRequisiti: diploma.\nFine',
    descriptionHtml:
      '<p>Concorso pubblico per un posto di &lt;b&gt;operatore&lt;/b&gt;</p><p>Requisiti: <strong>diploma</strong>.</p><p>Fine</p>',
    postedAt: new Date('2026-11-05T09:30:00Z'),
  });
});

void test('without a role the official title is the title; missing optional fields give empty ones', () => {
  const card = readItem({ id: 'abc', titolo: 'Avviso di mobilita' }, cleaner);
  assert.equal(card.title, 'Avviso di mobilita');
  assert.equal(card.company, '');
  assert.equal(card.location, '');
  assert.equal(card.postedAt, undefined);
  assert.equal(readItem(item(1, { entiRiferimento: ['A', 'B'] }), cleaner).company, 'A, B');
  assert.equal(readItem(item(1, { dataPubblicazione: 'not a date' }), cleaner).postedAt, undefined);
});

void test('a national competition is placed in Italy so the location filter lets it through', () => {
  assert.equal(placeOf(['Nazionale']), 'Italy');
  assert.equal(placeOf([' nazionale ']), 'Italy');
  assert.equal(placeOf(['Piemonte', 'Novara']), 'Piemonte, Novara');
  assert.equal(placeOf(['Piemonte', 'Nazionale']), 'Piemonte, Nazionale');
  assert.equal(placeOf(undefined), '');
});

void test('it reads pages until the cap and no further', async () => {
  const served = serveInpa([
    ok(page([item(1), item(2)], false)),
    ok(page([item(3), item(4)], false)),
    ok(page([item(5)], true)),
  ]);
  const { value } = context(served.fetch, {}, { maxPages: 2 });
  const result = await source.search(input, value);
  assert.equal(served.requests.length, 2);
  assert.deepEqual(
    result.cards.map((card) => card.title),
    ['Operatore 1', 'Operatore 2', 'Operatore 3', 'Operatore 4'],
  );
  assert.equal(result.error, undefined);
  // Stopped by the cap with pages left: not the whole list, so nothing it lacks may be taken as closed.
  assert.notEqual(result.complete, true);
});

void test('it stops at the last page, and a card repeated across pages is kept once', async () => {
  const served = serveInpa([ok(page([item(1), item(2)], false)), ok(page([item(2), item(3)], true))]);
  const { value } = context(served.fetch);
  const result = await source.search(input, value);
  assert.equal(served.requests.length, 2);
  assert.equal(result.cards.length, 3);
  assert.equal(result.complete, true);
});

void test('the profile result cap does not cut the list (maxResults of the search input is ignored)', async () => {
  const served = serveInpa([ok(page([item(1), item(2), item(3)], true))]);
  const result = await source.search({ ...input, maxResults: 1 }, context(served.fetch).value);
  assert.equal(result.cards.length, 3);
});

void test('requests are one second apart on the injected clock', async () => {
  const served = serveInpa([ok(page([item(1)], false)), ok(page([item(2)], false)), ok(page([item(3)], true))]);
  const { value, sleeps } = context(served.fetch);
  await source.search(input, value);
  assert.equal(served.requests.length, 3);
  assert.deepEqual(sleeps, [1000, 1000]);
});

void test('a 429 with Retry-After waits that many seconds and reads the same page again', async () => {
  const served = serveInpa([status(429, { 'retry-after': '7' }), ok(page([item(1)], true))]);
  const waits: Array<[string, number | null]> = [];
  const { value, sleeps } = context(served.fetch, { reportWait: (site, seconds) => void waits.push([site, seconds]) });
  const result = await source.search(input, value);
  assert.deepEqual(sleeps, [7000]);
  assert.deepEqual(waits, [
    ['inpa', 7],
    ['inpa', null],
  ]);
  assert.equal(served.requests.length, 2);
  assert.equal(served.requests[0]?.url, served.requests[1]?.url);
  assert.equal(result.cards.length, 1);
  assert.equal(result.error, undefined);
});

void test('a 429 without a header waits 30 s; repeated or too long a wait ends the search with the cards read', async () => {
  const quiet = serveInpa([status(429), ok(page([item(1)], true))]);
  const first = context(quiet.fetch);
  await source.search(input, first.value);
  assert.deepEqual(first.sleeps, [30_000]);

  const stuck = serveInpa([ok(page([item(1)], false)), status(429), status(429), status(429)]);
  const second = await source.search(input, context(stuck.fetch).value);
  assert.equal(second.cards.length, 1);
  assert.equal(second.error?.message, 'inpa: HTTP 429');

  const long = serveInpa([status(429, { 'retry-after': '3600' })]);
  const third = context(long.fetch);
  const result = await source.search(input, third.value);
  assert.equal(result.error?.message, 'inpa: HTTP 429');
  assert.deepEqual(third.sleeps, []);
});

void test('a failing page keeps the cards of the pages before it, and the error names no content', async () => {
  const { log, records } = capturingLog();
  const served = serveInpa([ok(page([item(1), item(2)], false)), status(500)]);
  const result = await source.search(input, context(served.fetch, { log }).value);
  assert.deepEqual(
    result.cards.map((card) => card.title),
    ['Operatore 1', 'Operatore 2'],
  );
  assert.equal(result.error?.message, 'inpa: HTTP 500');
  assert.notEqual(result.complete, true);
  assert.ok(!/Operatore|Comune|id000/.test(JSON.stringify(records)));
});

void test('an answer of another shape is the page error, and so is a network failure', async () => {
  const shapes = [
    'not json',
    JSON.stringify({ content: 'x', last: true }),
    JSON.stringify({ content: [{ id: 1 }], last: true }),
  ];
  for (const body of shapes) {
    const result = await source.search(input, context(serveInpa([ok(body)]).fetch).value);
    assert.deepEqual(result.cards, []);
    assert.equal(result.error?.message, 'inpa: unexpected answer');
  }
  const down: typeof fetch = async () => {
    throw new TypeError('connect ECONNREFUSED 203.0.113.1:443');
  };
  const result = await source.search(input, context(down).value);
  assert.equal(result.error?.message, 'inpa: request failed');
});

void test('cancelling after a page stops the reading', async () => {
  const controller = new AbortController();
  const first = ok(page([item(1)], false));
  const served = serveInpa([
    () => {
      const response = first();
      controller.abort();
      return response;
    },
    ok(page([item(2)], true)),
  ]);
  const result = await source.search(input, context(served.fetch, { signal: controller.signal }).value);
  assert.equal(served.requests.length, 1);
  assert.equal(result.error, undefined);
});

void test('the request is a POST for the open competitions of the configured region, page by page', async () => {
  const served = serveInpa([ok(page([item(1)], false)), ok(page([item(2)], true))]);
  await source.search(input, context(served.fetch).value);
  const body = { text: '', categoriaId: null, regioneId: 12, status: ['OPEN'] };
  assert.deepEqual(
    served.requests.map(({ url, method, body: sent }) => ({ url, method, sent })),
    [
      { url: `${API}?page=0&size=100`, method: 'POST', sent: body },
      { url: `${API}?page=1&size=100`, method: 'POST', sent: body },
    ],
  );
  const other = serveInpa([ok(page([], true))]);
  await source.search(input, context(other.fetch, {}, { regionId: 3, pageSize: 20 }).value);
  assert.deepEqual(other.requests[0], {
    url: `${API}?page=0&size=20`,
    method: 'POST',
    body: { text: '', categoriaId: null, regioneId: 3, status: ['OPEN'] },
  });
});

void test('an item whose category is in stable.inpaSkipCategories gives no card; case and accents are ignored', async () => {
  const served = () =>
    serveInpa([
      ok(
        page(
          [
            item(1, { categorie: ['Avvisi di mobilità'] }),
            item(2, { categorie: ['Concorso'] }),
            item(3, { categorie: ['Concorso', 'SELEZIONE professionisti ed esperti'] }),
            item(4, { categorie: [] }),
            item(5, { categorie: undefined }),
          ],
          true,
        ),
      ),
    ]);
  const skipping = testProfile((p) => {
    Object.assign(p, { stable: { inpaSkipCategories: ['avvisi di mobilita', 'Selezione Professionisti ed Esperti'] } });
  });
  const result = await source.search(input, context(served().fetch, { stable: skipping.stable }).value);
  assert.deepEqual(
    result.cards.map((card) => card.title),
    ['Operatore 2', 'Operatore 4', 'Operatore 5'],
  );
  // Negative check: with an empty list, or no stable section, every item stays.
  const empty = testProfile((p) => {
    Object.assign(p, { stable: {} });
  });
  assert.equal((await source.search(input, context(served().fetch, { stable: empty.stable }).value)).cards.length, 5);
  assert.equal((await source.search(input, context(served().fetch).value)).cards.length, 5);
});

void test('it is a list source named inpa, with no detail call', () => {
  assert.equal(source.name, 'inpa');
  assert.equal(source.kind, 'list');
  assert.equal(source.describe, undefined);
});

void test('towns and Unioni use their body name, other or multiple bodies do not', () => {
  for (const prefix of [
    'Comune di ',
    "Comune d'",
    'Comune del ',
    'Comune della ',
    'Comune dello ',
    'Comune dei ',
    'Comune degli ',
    'Città di ',
  ]) {
    assert.equal(townOf([`${prefix}Susa (TO)`]), 'Susa');
  }
  assert.equal(townOf(['  COMUNE   DI   PraRosTiNo  ']), 'PraRosTiNo');
  assert.equal(townOf(['Unione Montana Valle Susa']), 'Unione Montana Valle Susa');
  for (const bodies of [
    null,
    [],
    ['Città metropolitana di Torino'],
    ['ARPA Piemonte'],
    ['Ministero della Salute'],
    ['Comune di Susa', 'Comune di Torino'],
  ]) {
    assert.equal(townOf(bodies), undefined);
  }
});

void test('readItem selects a town, otherwise the normal place including Italy', () => {
  assert.equal(
    readItem(item(1, { entiRiferimento: ['Comune di Prarostino'], sedi: ['Piemonte', 'Torino'] }), cleaner).location,
    'Prarostino',
  );
  assert.equal(
    readItem(item(1, { entiRiferimento: ['ARPA Piemonte'], sedi: ['Piemonte', 'Torino'] }), cleaner).location,
    'Piemonte, Torino',
  );
  assert.equal(readItem(item(1, { entiRiferimento: ['Ministero'], sedi: ['Nazionale'] }), cleaner).location, 'Italy');
});
