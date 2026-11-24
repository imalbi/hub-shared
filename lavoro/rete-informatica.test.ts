import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from 'linkedom';
import { card, detail, html, jobLink, listing, LIST_URL, serveHtml } from './fake-rete.ts';
import { capturingLog, silentLog, testProfile } from './harness.ts';
import { createReteInformaticaSource, jobUrl, placeOf, readCard, readDetail } from './rete-informatica.ts';
import type { SearchInput, SourceContext } from './source.ts';

// Everything here is invented; the markup follows the friend's fixtures and the shape the 16e live check confirmed.

const NOW = new Date(2026, 10, 5, 8).getTime();
const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
const doc = (markup: string) => parseHTML(markup).document;
const firstCard = (markup: string) => {
  const element = doc(listing(markup)).querySelector('article.ol-card');
  assert.ok(element);
  return readCard(element);
};

function input(patch: Partial<SearchInput> = {}): SearchInput {
  return {
    query: { name: 'Web', keywords: 'ignored', indeedTerms: [] },
    location: 'Italy',
    hoursOld: 36,
    maxResults: 250,
    knownPagesToStop: 1,
    ...patch,
  };
}

function context(patch: Partial<SourceContext> & { fetch: typeof fetch }) {
  const profile = testProfile();
  let now = NOW;
  const sleeps: number[] = [];
  const value: SourceContext = {
    signal: new AbortController().signal,
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

/** Fifteen distinct cards, the size of a full listing page, from id `from` on. */
const fullPage = (from: number) =>
  listing(...Array.from({ length: 15 }, (_, n) => card(from + n, `Developer ${from + n}`)));

void test('the posting URL keeps only the id, and a link that is not a posting has none', () => {
  assert.equal(jobUrl('/lavoro/61961/java-exampleville?x=1'), jobLink(61961));
  assert.equal(jobUrl('/lavoro/7'), jobLink(7));
  assert.equal(jobUrl('/offerte-di-lavoro'), '');
});

void test('a place with a province code becomes city, code, Italia; a foreign one stays as written', () => {
  assert.equal(placeOf(' Exampleville  (EX) '), 'Exampleville, EX, Italia');
  assert.equal(placeOf('Farawayburg'), 'Farawayburg');
});

void test('a card gives the id, the title without its reference code, the date and the declared mode', () => {
  const read = firstCard(card(61961, 'JAVA DEVELOPER', { code: '1805', remote: 'Totale', day: new Date(2026, 10, 3) }));
  assert.ok(read);
  assert.equal(read.url, jobLink(61961));
  assert.equal(read.title, 'JAVA DEVELOPER');
  assert.equal(read.company, 'Company 61961');
  assert.equal(read.location, 'Exampleville, EX, Italia');
  assert.equal(read.declaredMode, 'remote');
  assert.equal(read.postedAt?.getTime(), new Date(2026, 10, 3).getTime());
  assert.equal(read.site, 'reteinformaticalavoro');
  assert.equal(firstCard(card(1, 'Dev', { remote: 'Parziale' }))?.declaredMode, 'hybrid');
  assert.equal(firstCard(card(1, 'Dev', { remote: '' }))?.declaredMode, undefined);
});

void test('a card without an id, a title or a company is skipped', () => {
  assert.equal(firstCard(card(1, 'Dev').replace('/lavoro/1/', '/offerte-di-lavoro/')), undefined);
  assert.equal(firstCard(card(1, '')), undefined);
  assert.equal(firstCard(card(1, 'Dev', { company: '' })), undefined);
});

void test('a detail page gives title, company, place, mode, date and the cleaned description', () => {
  const read = readDetail(
    doc(
      detail('JAVA BACK-END DEVELOPER (Otherville/ibrido)', 'EXAMPLE SRL', {
        body: '<p class="an-sez"><strong>Requisiti</strong></p><ul><li>Java &amp; Spring</li></ul><script>alert(1)</script>',
      }),
    ),
    cleaner,
  );
  assert.equal(read.title, 'JAVA BACK-END DEVELOPER (Otherville/ibrido)');
  assert.equal(read.company, 'EXAMPLE SRL');
  assert.equal(read.location, 'Otherville, OT, Italia');
  assert.equal(read.declaredMode, 'hybrid');
  // The JSON-LD has raw line breaks in a string: it still parses, and its date wins over the shown one.
  assert.equal(read.postedAt?.getTime(), new Date(2026, 10, 3).getTime());
  assert.equal(read.descriptionHtml, '<p><strong>Requisiti</strong></p><ul><li>Java &amp; Spring</li></ul>');
  assert.equal(read.description, 'Requisiti\nJava & Spring');
});

void test('a fully remote posting without a place takes its company from the JSON-LD', () => {
  const read = readDetail(
    doc(detail('AI Engineer', 'INVENTED S.R.L.', { place: '', remote: 'Totale', linkedCompany: false })),
    cleaner,
  );
  assert.deepEqual([read.company, read.location, read.declaredMode], ['INVENTED S.R.L.', undefined, 'remote']);
});

void test('without JSON-LD the shown date is used', () => {
  const read = readDetail(doc(detail('Dev', 'Acme', { jsonLd: false })), cleaner);
  assert.equal(read.postedAt?.getTime(), new Date(2026, 10, 2).getTime());
});

void test('new postings are read with their detail until one is older than the window, known ones are not fetched', async () => {
  const old = new Date(2026, 9, 31);
  const site = serveHtml((url) =>
    url === LIST_URL
      ? html(
          listing(
            card(1, 'Backend developer', { place: 'Exampleville (EX)' }),
            card(2, 'Data engineer'),
            card(3, 'Old one', { day: old }),
            card(4, 'New after old'),
          ),
        )
      : html(detail('Backend developer, Node', 'Company 1 S.r.l.', { place: 'Exampleville (EX)' })),
  );
  const { value } = context({ fetch: site.fetch, isKnown: (url) => url === jobLink(2) });
  const { cards, error } = await createReteInformaticaSource().search(input(), value);
  assert.equal(error, undefined);
  // The listing once, then only the unknown posting; the page with an older card is the last one.
  assert.deepEqual(site.urls, [LIST_URL, jobLink(1), jobLink(4)]);
  assert.deepEqual(
    cards.map((c) => c.url),
    [jobLink(1), jobLink(2), jobLink(4)],
  );
  const [first, known] = cards;
  assert.deepEqual(
    [first?.title, first?.company, first?.description],
    ['Backend developer, Node', 'Company 1 S.r.l.', 'Invented backend work.'],
  );
  assert.equal(first?.declaredMode, 'hybrid');
  assert.equal(known?.description, undefined);
  assert.equal(known?.detailsMissing, undefined);
});

void test('a detail without a place keeps the card one, and a failed detail is flagged and the listing goes on', async () => {
  const site = serveHtml((url, index) => {
    if (url === LIST_URL)
      return html(
        fullPage(100).replace(
          card(100, 'Developer 100'),
          card(100, 'Java developer', { place: 'Farawayburg', remote: 'Totale' }),
        ),
      );
    if (url === `${LIST_URL}?page=2`) return html(listing());
    if (url === jobLink(100)) return html(detail('Java developer', 'Company 100', { place: '', remote: 'Totale' }));
    return index === 2 ? html('busy', 503) : html(detail('Dev', 'Company'));
  });
  const { cards, error } = await createReteInformaticaSource().search(input(), context({ fetch: site.fetch }).value);
  assert.equal(error, undefined);
  assert.equal(cards[0]?.location, 'Farawayburg');
  assert.equal(cards[0]?.declaredMode, 'remote');
  assert.equal(cards[1]?.detailsMissing, true);
  assert.equal(cards[1]?.description, undefined);
  assert.equal(cards.length, 15);
  assert.equal(site.urls.at(-1), `${LIST_URL}?page=2`);
});

void test('paging stops on known pages, on a short page, on an empty page and at maxResults', async () => {
  const known = serveHtml((url) =>
    html(url.startsWith(LIST_URL) ? fullPage(Number(url.split('page=')[1] ?? 1) * 100) : detail('Dev', 'C')),
  );
  await createReteInformaticaSource().search(input(), context({ fetch: known.fetch, isKnown: () => true }).value);
  assert.deepEqual(known.urls, [LIST_URL]);

  const short = serveHtml((url) =>
    html(url === LIST_URL ? listing(card(1, 'Dev'), card(2, 'Dev two')) : detail('Dev', 'C')),
  );
  await createReteInformaticaSource().search(input(), context({ fetch: short.fetch }).value);
  assert.deepEqual(short.urls, [LIST_URL, jobLink(1), jobLink(2)]);

  const capped = serveHtml((url) => html(url === LIST_URL ? fullPage(1) : detail('Dev', 'C')));
  const { cards } = await createReteInformaticaSource().search(
    input({ maxResults: 2 }),
    context({ fetch: capped.fetch }).value,
  );
  assert.equal(cards.length, 2);
  assert.deepEqual(capped.urls, [LIST_URL, jobLink(1), jobLink(2)]);

  const empty = serveHtml(() => html(listing()));
  const none = await createReteInformaticaSource().search(input(), context({ fetch: empty.fetch }).value);
  assert.deepEqual([none.cards.length, none.error, empty.urls.length], [0, undefined, 1]);
});

void test('a failing page keeps the cards read before it and reports only the status', async () => {
  const site = serveHtml((url) => {
    if (url === LIST_URL) return html(fullPage(1));
    if (url.startsWith(LIST_URL)) return html('<p>secret body Developer</p>', 500);
    return html(detail('Dev', 'C'));
  });
  const { log, records } = capturingLog();
  const { cards, error } = await createReteInformaticaSource().search(
    input(),
    context({ fetch: site.fetch, log }).value,
  );
  assert.equal(cards.length, 15);
  assert.equal(error?.message, 'reteinformaticalavoro: HTTP 500');
  const logged = JSON.stringify(records);
  for (const leak of ['secret', 'Developer', 'lavoro/1', 'Company']) assert.ok(!logged.includes(leak), leak);
});

void test('a page where no card reads is an error with the count only', async () => {
  const site = serveHtml(() => html(listing(card(1, ''), card(2, ''))));
  const { error } = await createReteInformaticaSource().search(input(), context({ fetch: site.fetch }).value);
  assert.equal(error?.message, 'reteinformaticalavoro: none of the 2 cards could be read');
});

void test('listing and details together wait one second between requests', async () => {
  const site = serveHtml((url) =>
    html(url === LIST_URL ? listing(card(1, 'Dev'), card(2, 'Dev two')) : detail('Dev', 'C')),
  );
  const { value, sleeps } = context({ fetch: site.fetch });
  await createReteInformaticaSource().search(input(), value);
  assert.equal(site.urls.length, 3);
  assert.deepEqual(sleeps, [1000, 1000]);
});

void test('a cancelled collection stops paging and reports nothing', async () => {
  const controller = new AbortController();
  const site = serveHtml((url) => {
    if (url === jobLink(2)) controller.abort();
    return html(url.startsWith(LIST_URL) ? fullPage(1) : detail('Dev', 'C'));
  });
  const result = await createReteInformaticaSource().search(
    input(),
    context({ fetch: site.fetch, signal: controller.signal }).value,
  );
  assert.equal(result.error, undefined);
  assert.ok(site.urls.length <= 3);
});

void test('a full page with an older card is the last page read', async () => {
  const page = fullPage(1).replace(card(15, 'Developer 15'), card(15, 'Developer 15', { day: new Date(2026, 9, 1) }));
  const site = serveHtml((url) => html(url.startsWith(LIST_URL) ? page : detail('Dev', 'C')));
  const { cards } = await createReteInformaticaSource().search(input(), context({ fetch: site.fetch }).value);
  assert.equal(cards.length, 14);
  assert.ok(!site.urls.includes(`${LIST_URL}?page=2`));
});

void test('a page that only repeats cards already read ends the search, so a site that serves one page forever cannot loop', async () => {
  const site = serveHtml((url) => html(url.startsWith(LIST_URL) ? fullPage(1) : detail('Dev', 'C')));
  const { cards } = await createReteInformaticaSource().search(input(), context({ fetch: site.fetch }).value);
  assert.equal(cards.length, 15);
  assert.equal(site.urls.filter((url) => url.startsWith(LIST_URL)).length, 2);
});

void test('a detail page without a description is flagged missing, so a moved page is retried instead of judged on the title', async () => {
  const site = serveHtml((url) =>
    html(url === LIST_URL ? listing(card(1, 'Dev')) : detail('Dev', 'C').replace('class="an-testo"', 'class="moved"')),
  );
  const { cards } = await createReteInformaticaSource().search(input(), context({ fetch: site.fetch }).value);
  assert.equal(cards[0]?.detailsMissing, true);
  assert.equal(cards[0]?.title, 'Dev');
});
