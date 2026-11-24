import assert from 'node:assert/strict';
import { test } from 'node:test';
import { board, BOARD_URL, detail, detailUrl, element, html, serveHtml } from './fake-iren.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { createIrenSource } from './iren.ts';
import { knownUrls } from './schema.ts';

// The real IRENfutura source inside the real engine, on the virtual clock, with a fetch that serves invented pages.
// The source's own rules are in `iren.test.ts`.

const profile = testProfile((p) => {
  p.search.sites = ['iren'];
  p.search.queries = [{ name: 'Web', keywords: 'ignored', indeedTerms: [] }];
  Object.assign(p, { stable: { sites: ['iren'], titleWeights: { addetto: 2 } } });
});

/** The board's first posting wants a diploma, the second a degree, the third is in another region, the fourth has a title no weight hits. */
function site(log?: Array<{ url: string; at: number }>, now: () => number = () => 0) {
  return serveHtml((url) => {
    log?.push({ url, at: now() });
    if (url === BOARD_URL)
      return html(
        board(
          element(1, { agency: 'Agenzia X' }),
          element(2),
          element(3, { region: '01' }),
          element(4, { title: 'Impiegato amministrativo' }),
        ),
      );
    if (url === detailUrl('AV 1001')) return html(detail('Addetto/a esempio 1', { agency: 'Agenzia X' }));
    if (url === detailUrl('AV 1002'))
      return html(detail('Addetto/a esempio 2', { level: 'Laurea magistrale', degree: 'Laurea in Esempio' }));
    return html('busy', 503);
  });
}

void test('IRENfutura postings are Stabile end to end: a diploma one is saved with its deadline, a degree one is dropped', async () => {
  const h = createHarness({ sources: [createIrenSource()], fetch: site().fetch, profile });
  const { requirements } = await h.collect();
  const saved = rows(h.db);
  assert.deepEqual(
    saved.map((row) => row.title),
    ['Addetto/a esempio 1'],
  );
  const [row] = saved;
  assert.equal(row?.site, 'iren');
  assert.deepEqual(row?.categories, ['Stabile']);
  assert.equal(row?.company, 'Iren tramite Agenzia X');
  assert.ok(row?.description?.startsWith('Scadenza: 10/12/2026\nInvented abstract.'));
  assert.equal(row?.detailsMissing, false);
  assert.deepEqual(requirements, { laurea: 1 });
});

void test('a posting whose title hits no weight stays out, though Iren makes it Stabile', async () => {
  const h = createHarness({ sources: [createIrenSource()], fetch: site().fetch, profile });
  await h.collect();
  assert.equal(
    rows(h.db).some((row) => row.title === 'Impiegato amministrativo'),
    false,
  );
});

void test('a known posting gets no detail request on the next collection', async () => {
  const first = site();
  const h = createHarness({ sources: [createIrenSource()], fetch: first.fetch, profile });
  await h.collect();
  assert.ok(first.urls.includes(detailUrl('AV 1001')));
  const before = first.urls.length;
  await h.collect();
  const again = first.urls.slice(before);
  assert.ok(again.includes(BOARD_URL));
  assert.equal(again.includes(detailUrl('AV 1001')), false);
});

void test('a failing detail keeps the card with the abstract, saved incomplete and not cached', async () => {
  const pages = serveHtml((url) =>
    url === BOARD_URL ? html(board(element(1, { abstract: 'Only the abstract.' }))) : html('busy', 503),
  );
  const h = createHarness({ sources: [createIrenSource()], fetch: pages.fetch, profile });
  assert.equal((await h.collect()).status, 'done');
  const [row] = rows(h.db);
  assert.equal(row?.description, 'Only the abstract.');
  assert.equal(row?.detailsMissing, true);
  assert.deepEqual(h.db.select().from(knownUrls).all(), []);
});

void test('the board and every detail are requested one second apart on the virtual clock', async () => {
  const log: Array<{ url: string; at: number }> = [];
  let now = () => 0;
  const pages = site(log, () => now());
  const h = createHarness({ sources: [createIrenSource()], fetch: pages.fetch, profile });
  now = h.clock.now;
  await h.collect();
  assert.equal(log.length, 4); // the board and the details of the three postings in the region
  assert.equal(log[0]?.url, BOARD_URL);
  for (const [index, entry] of log.entries()) {
    const previous = log[index - 1];
    if (previous)
      assert.ok(entry.at - previous.at >= 1000, `${entry.url} came ${entry.at - previous.at} ms after the last`);
  }
});

void test('a dry run reads the board once, fetches the details and writes nothing', async () => {
  const pages = site();
  const h = createHarness({ sources: [createIrenSource()], fetch: pages.fetch, profile });
  const { status, dryRun } = await h.collect('prova');
  assert.equal(status, 'done');
  assert.equal(pages.urls.filter((url) => url === BOARD_URL).length, 1);
  assert.equal(dryRun.length, 1);
  assert.equal(rows(h.db).length, 0);
});
