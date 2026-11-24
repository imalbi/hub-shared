import assert from 'node:assert/strict';
import { test } from 'node:test';
import { card, detail, html, jobLink, listing, LIST_URL, serveHtml } from './fake-rete.ts';
import { createHarness, rows, testProfile } from './harness.ts';
import { createReteInformaticaSource } from './rete-informatica.ts';
import { knownUrls } from './schema.ts';

// The real Rete Informatica Lavoro source inside the real engine, on the virtual clock, with a fetch that serves
// invented pages. The source's own rules are in `rete-informatica.test.ts`.

const profile = testProfile((p) => {
  p.search.sites = ['reteinformaticalavoro'];
  p.search.queries = [{ name: 'Web', keywords: 'ignored', indeedTerms: [] }];
});

function site() {
  return serveHtml((url) => {
    if (url === LIST_URL) return html(listing(card(1, 'Frontend developer'), card(2, 'Frontend developer two')));
    if (url === jobLink(1))
      return html(
        detail('Frontend developer', 'Company 1', { place: 'Exampleville (EX)', body: '<p>We use typescript</p>' }),
      );
    return html('busy', 503);
  });
}

void test('a board posting declared totally remote passes outside the preferred areas', async () => {
  const pages = serveHtml((url) =>
    url === LIST_URL
      ? html(listing(card(1, 'Frontend developer', { place: 'Otherville (OT)', remote: 'Totale' })))
      : html(detail('Frontend developer', 'Company 1', { place: 'Otherville (OT)', remote: 'Totale' })),
  );
  const h = createHarness({ sources: [createReteInformaticaSource()], fetch: pages.fetch, profile });
  await h.collect();
  assert.equal(rows(h.db).length, 1);
  assert.equal(rows(h.db)[0]?.workMode, 'remote');
});

void test('a dry run lists the board once, with the detail text scored, and writes nothing', async () => {
  const pages = site();
  const h = createHarness({ sources: [createReteInformaticaSource()], fetch: pages.fetch, profile });
  const { status, dryRun } = await h.collect('prova');
  assert.equal(status, 'done');
  assert.equal(pages.urls.filter((url) => url.startsWith(LIST_URL)).length, 1);
  const first = dryRun.find((row) => row.url === jobLink(1));
  assert.equal(first?.site, 'reteinformaticalavoro');
  assert.ok(first?.reasons.some((reason) => reason.startsWith('typescript:')));
  assert.equal(rows(h.db).length, 0);
});

void test('a collection saves the cleaned HTML, and a posting whose detail failed is saved incomplete and not cached', async () => {
  const h = createHarness({ sources: [createReteInformaticaSource()], fetch: site().fetch, profile });
  assert.equal((await h.collect('raccolta')).status, 'done');
  const byUrl = new Map(rows(h.db).map((row) => [row.url, row]));
  assert.deepEqual(
    [byUrl.get(jobLink(1))?.description, byUrl.get(jobLink(1))?.descriptionHtml, byUrl.get(jobLink(1))?.detailsMissing],
    ['We use typescript', '<p>We use typescript</p>', false],
  );
  assert.equal(byUrl.get(jobLink(2))?.detailsMissing, true);
  assert.deepEqual(
    h.db
      .select()
      .from(knownUrls)
      .all()
      .map((row) => row.url),
    [jobLink(1)],
  );
});
