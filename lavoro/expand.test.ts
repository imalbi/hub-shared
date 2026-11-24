import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileSchema } from './config.ts';
import { expandSearches } from './expand.ts';
import { createFakeSource } from './fake-source.ts';
import { inventedProfile } from './invented-profile.ts';

const profile = profileSchema.parse(inventedProfile());
const registry = (...kinds: Array<['indeed' | 'reteinformaticalavoro' | 'linkedin', 'search' | 'list']>) =>
  new Map(kinds.map(([name, kind]) => [name, createFakeSource({ name, kind })]));

void test('every query is combined with every site it lists, in profile order', () => {
  const sources = registry(['indeed', 'search'], ['reteinformaticalavoro', 'search'], ['linkedin', 'search']);
  const searches = expandSearches(profile, sources);
  assert.deepEqual(
    searches.map((search) => `${search.input.query.name}:${search.site}`),
    [
      'Web:indeed',
      'Web:reteinformaticalavoro',
      'Web:linkedin',
      'Data:indeed',
      'Data:reteinformaticalavoro',
      'Data:linkedin',
    ],
  );
});

void test('a list source appears once, with the limits of the first query that lists it', () => {
  const sources = registry(['indeed', 'search'], ['reteinformaticalavoro', 'list'], ['linkedin', 'search']);
  const searches = expandSearches(profile, sources);
  const lists = searches.filter((search) => search.site === 'reteinformaticalavoro');
  assert.equal(lists.length, 1);
  assert.equal(lists[0]?.input.query.name, 'Web');
  assert.equal(lists[0]?.input.maxResults, 50);
  assert.equal(searches.length, 5);
});

void test('a list source is read with the first query that lists it, even when an earlier query skips it', () => {
  const custom = profileSchema.parse({
    ...inventedProfile(),
    search: {
      ...inventedProfile().search,
      queries: [
        { name: 'No list', keywords: 'a', sites: ['indeed'] },
        { name: 'With list', keywords: 'b', maxResults: 7, knownPagesToStop: 3 },
      ],
    },
  });
  const sources = registry(['indeed', 'search'], ['reteinformaticalavoro', 'list'], ['linkedin', 'search']);
  const list = expandSearches(custom, sources).find((search) => search.site === 'reteinformaticalavoro');
  assert.equal(list?.input.query.name, 'With list');
  assert.equal(list?.input.maxResults, 7);
  assert.equal(list?.input.knownPagesToStop, 3);
});

void test('a query overrides sites, location and limits; the rest comes from the profile', () => {
  const [web, data] = [
    ...expandSearches(
      profile,
      registry(['indeed', 'search'], ['reteinformaticalavoro', 'search'], ['linkedin', 'search']),
    ),
  ].filter((search) => search.site === 'indeed');
  assert.equal(web?.input.maxResults, 50);
  assert.equal(data?.input.maxResults, 20);
  assert.equal(web?.input.knownPagesToStop, 2);
  assert.equal(web?.input.location, 'Examplia');
  assert.equal(web?.input.hoursOld, 72);

  const only = profileSchema.parse({
    ...inventedProfile(),
    search: {
      ...inventedProfile().search,
      queries: [{ name: 'Local', keywords: 'x', sites: ['linkedin', 'linkedin'], location: 'Elsewhere' }],
    },
  });
  const searches = expandSearches(only, registry(['indeed', 'search'], ['linkedin', 'search']));
  assert.deepEqual(
    searches.map((search) => [search.site, search.input.location]),
    [['linkedin', 'Elsewhere']],
  );
});

void test('a site with no registered source still gets a search, with no source to run', () => {
  const searches = expandSearches(profile, registry(['indeed', 'search']));
  assert.equal(searches.length, 6);
  assert.equal(searches.filter((search) => search.source === undefined).length, 4);
});

void test('Indeed searches its own place when set; other portals and a query with its own place are untouched', () => {
  const base = inventedProfile();
  const custom = profileSchema.parse({
    ...base,
    sources: { ...base.sources, indeed: { ...base.sources?.indeed, location: 'Localtown' } },
    search: {
      ...base.search,
      queries: [
        { name: 'General', keywords: 'a' },
        { name: 'Own place', keywords: 'b', location: 'Elsewhere' },
      ],
    },
  });
  const searches = expandSearches(custom, registry(['indeed', 'search'], ['linkedin', 'search']));
  assert.deepEqual(
    searches.map((search) => [search.input.query.name, search.site, search.input.location]),
    [
      ['General', 'indeed', 'Localtown'],
      ['General', 'reteinformaticalavoro', 'Examplia'],
      ['General', 'linkedin', 'Examplia'],
      ['Own place', 'indeed', 'Elsewhere'],
      ['Own place', 'reteinformaticalavoro', 'Elsewhere'],
      ['Own place', 'linkedin', 'Elsewhere'],
    ],
  );
});
