import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseHTML } from '../../apps/server/src/core/module-html.ts';
import { enel, listing } from './fake-avature.ts';
import { silentLog, testProfile } from './harness.ts';
import { createAvatureSource, readPage } from './avature.ts';
import type { SearchInput, SourceContext } from './source.ts';
import { requestUrl } from './test-http.ts';

void test('Enel list maps title, place, URL, id and total', () => {
  const page = readPage(parseHTML(listing(enel, [{ id: 12, location: 'Torino, Italy' }], 9)).document, enel);
  assert.equal(page.total, 9);
  assert.deepEqual(page.items, [
    {
      id: '12',
      title: 'Addetto esempio 12',
      location: 'Torino, Italy',
      country: '',
      url: 'https://enel.example.org/it/careers/JobDetail/12',
    },
  ]);
});

void test('Italian Città label and labeled description fields are parsed when unlabeled text is empty', async () => {
  const italianDetail =
    '<div class="article--details">' +
    '<div class="article__content__view__field"><div class="article__content__view__field__label">Nazione</div><div class="article__content__view__field__value">Italia</div></div>' +
    '<div class="article__content__view__field"><div class="article__content__view__field__label">Città</div><div class="article__content__view__field__value">Torino</div></div>' +
    '<div class="article__content__view__field"><div class="article__content__view__field__label">Descrizione</div><div class="article__content__view__field__value"><p>Manutenzione impianti elettrici.</p></div></div>' +
    '<div class="article__content__view__field"><div class="article__content__view__field__label">Requisiti</div><div class="article__content__view__field__value"><p>Diploma di perito elettrotecnico.</p></div></div>' +
    '</div>';
  const profile = testProfile((p) => Object.assign(p.search, { avature: { employers: [enel], maxPages: 1 } }));
  const input: SearchInput = {
    query: { name: 'Web', keywords: '', indeedTerms: [] },
    location: 'Italy',
    hoursOld: 36,
    maxResults: 1,
    knownPagesToStop: 1,
  };
  const ctx: SourceContext = {
    signal: new AbortController().signal,
    fetch: async (request) =>
      new Response(
        requestUrl(request).includes('JobDetail') ? italianDetail : listing(enel, [{ id: 12, location: '' }], 1),
      ),
    now: () => 0,
    sleep: async () => {},
    log: silentLog,
    isKnown: () => false,
    limits: profile.search,
    sources: profile.sources,
  };
  const res = await createAvatureSource().search(input, ctx);
  assert.equal(res.cards.length, 1);
  assert.equal(res.cards[0]?.detailsMissing, undefined);
  assert.equal(res.cards[0]?.location, 'Torino');
  assert.match(res.cards[0]?.description ?? '', /Manutenzione impianti elettrici/u);
  assert.match(res.cards[0]?.description ?? '', /Diploma di perito elettrotecnico/u);
});
