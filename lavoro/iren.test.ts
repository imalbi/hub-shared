import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { board, BOARD_URL, detail, detailUrl, element, html, serveHtml } from './fake-iren.ts';
import { silentLog, testProfile } from './harness.ts';
import { createIrenSource, readBoard, readDetail } from './iren.ts';
import type { SearchInput, SourceContext } from './source.ts';

// Everything here is invented; the markup follows the 16n3a live check (structure only).

const NOW = new Date(2026, 10, 10, 8).getTime();
const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
const read = (page: string) => readBoard(parseHTML(page).document);

const input: SearchInput = {
  query: { name: 'Web', keywords: 'ignored', indeedTerms: [] },
  location: 'Italy',
  hoursOld: 36,
  maxResults: 1,
  knownPagesToStop: 1,
};

function context(fetch: typeof globalThis.fetch, patch: Partial<SourceContext> = {}, iren: object = {}) {
  const profile = testProfile((p) => {
    Object.assign(p.search, { iren: { regions: ['02'], ...iren } });
  });
  let now = NOW;
  const sleeps: number[] = [];
  const waits: Array<number | null> = [];
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
    reportWait: (_site, seconds) => void waits.push(seconds),
    ...patch,
  };
  return { value, sleeps, waits };
}

const source = createIrenSource();

void test('the board parses into items: region, id, title, town, abstract and agency', () => {
  const { items, total } = read(
    board(
      element(1, {
        title: 'Addetto/a conduzione impianti',
        town: 'Torino',
        abstract: 'Run the plant.',
        agency: 'Agenzia X',
      }),
      element(2, { region: '01', town: 'Reggio Esempio' }),
    ),
  );
  assert.equal(total, 2);
  assert.deepEqual(items[0], {
    region: '02',
    id: 'AV 1001',
    title: 'Addetto/a conduzione impianti',
    town: 'Torino',
    abstract: 'Run the plant.',
    agency: 'Agenzia X',
  });
  assert.equal(items[1]?.region, '01');
  assert.equal(items[1]?.agency, undefined);
});

void test('a title without a town in brackets keeps its text and has no town', () => {
  const [item] = read(board(element(1, { title: 'Tecnico (junior) manutenzione', town: null }))).items;
  assert.equal(item?.title, 'Tecnico (junior) manutenzione');
  assert.equal(item?.town, undefined);
});

void test('an element with no link to a posting is skipped but still counts as a board element', () => {
  const broken =
    '<div class="element 02" data-category="02"><div class="item_description"><h4>No link (X)</h4></div></div>';
  const { items, total } = read(board(broken, element(1)));
  assert.equal(total, 2);
  assert.equal(items.length, 1);
});

void test('a card: town as location, Iren as company, the id with a space encoded in the URL', async () => {
  const served = serveHtml((url) =>
    url === BOARD_URL
      ? html(board(element(1, { town: 'Torino', agency: 'Agenzia X' }), element(2, { town: null })))
      : html('', 404),
  );
  const { value } = context(served.fetch, { isKnown: () => true });
  const { cards } = await source.search(input, value);
  assert.deepEqual(cards[0], {
    url: 'https://irenfutura.gruppoiren.it/irenlavoraconnoi/Default.aspx?tabid=201&jobid=AV%201001',
    title: 'Addetto/a esempio 1',
    company: 'Iren tramite Agenzia X',
    location: 'Torino',
    site: 'iren',
    description: 'Invented duties 1.',
    descriptionHtml: '<p>Invented duties 1.</p>',
  });
  assert.equal(cards[1]?.company, 'Iren');
  assert.equal(cards[1]?.location, input.location);
  assert.equal(cards[0]?.url, detailUrl('AV 1001'));
});

void test('a card without a town uses the search location for each collection', async () => {
  const served = serveHtml(() => html(board(element(1, { town: null }))));
  for (const location of ['Liguria', 'Emilia Romagna']) {
    const { value } = context(served.fetch, { isKnown: () => true });
    const { cards } = await source.search({ ...input, location }, value);
    assert.equal(cards[0]?.location, location);
  }
});

void test('only the configured regions become cards, by the board code and not by the town', async () => {
  const page = board(
    element(1, { region: '02', town: 'Reggio Esempio' }),
    element(2, { region: '01', town: 'Torino' }),
    element(3, { region: '03' }),
  );
  const run = async (iren: object) => {
    const served = serveHtml(() => html(page));
    const { value } = context(served.fetch, { isKnown: () => true }, iren);
    return (await source.search(input, value)).cards.map((card) => card.title);
  };
  assert.deepEqual(await run({}), ['Addetto/a esempio 1']);
  assert.deepEqual(await run({ regions: ['01', '02'] }), ['Addetto/a esempio 1', 'Addetto/a esempio 2']);
});

void test('a board with no elements is the layout-changed error, not an empty result', async () => {
  const served = serveHtml(() => html('<html><body><p>Manutenzione in corso</p></body></html>'));
  const { value } = context(served.fetch);
  const result = await source.search(input, value);
  assert.deepEqual(result.cards, []);
  assert.equal(result.error?.message, 'iren: the board layout changed');
  assert.notEqual(result.complete, true);
});

void test('a board with elements but none in the region is an empty result without an error', async () => {
  const served = serveHtml(() => html(board(element(1, { region: '01' }))));
  const { value } = context(served.fetch);
  const result = await source.search(input, value);
  assert.deepEqual(result.cards, []);
  assert.equal(result.error, undefined);
  assert.equal(result.complete, true);
});

void test('the detail adds the deadline, abstract, text and study requirements, cleaned', () => {
  const found = readDetail(
    parseHTML(
      detail('Addetto/a esempio 1', {
        deadline: '10/12/2026',
        abstract: 'Short <b>duties</b>.',
        body: 'First paragraph.\nSecond <script>x()</script>line.',
        level: 'Laurea magistrale',
        degree: 'Laurea in Esempio',
      }),
    ).document,
    cleaner,
  );
  assert.equal(
    found.description,
    [
      'Scadenza: 10/12/2026',
      'Short duties.',
      'First paragraph.',
      'Second line.',
      'Livello di studio: Laurea magistrale',
      'Titolo di studio richiesto: Laurea in Esempio',
    ].join('\n'),
  );
  assert.ok(found.descriptionHtml?.startsWith('<p>Scadenza: 10/12/2026</p><p><i>Short <b>duties</b>.</i></p>'));
  assert.ok(!found.descriptionHtml?.includes('script'));
});

void test('a detail page without the form rows gives no description', () => {
  assert.equal(
    readDetail(parseHTML('<html><body><p>Errore</p></body></html>').document, cleaner).description,
    undefined,
  );
});

void test('a 429 waits for Retry-After, reports the wait, and tries again; a second one gives up as an error', async () => {
  let calls = 0;
  const served = serveHtml(() => {
    calls++;
    return calls === 1 ? html('', 429, { 'retry-after': '7' }) : html(board(element(1)));
  });
  const { value, sleeps, waits } = context(served.fetch, { isKnown: () => true });
  const result = await source.search(input, value);
  assert.equal(result.cards.length, 1);
  assert.ok(sleeps.includes(7000));
  assert.deepEqual(waits, [7, null]);

  const never = serveHtml(() => html('', 429, { 'retry-after': '1' }));
  const again = context(never.fetch);
  const failed = await source.search(input, again.value);
  assert.equal(failed.error?.message, 'iren: HTTP 429');
  assert.equal(never.urls.length, 3);
});

void test('a server error on the board is an error with the status only', async () => {
  const served = serveHtml(() => html('secret body', 503));
  const { value } = context(served.fetch);
  const result = await source.search(input, value);
  assert.equal(result.error?.message, 'iren: HTTP 503');
});
