import assert from 'node:assert/strict';
import { test } from 'node:test';
import { locationBonus, locationPasses } from './location.ts';
import { provinceRegion } from './province-regions.ts';
import { provinceTowns } from './province-towns.ts';

const filter = {
  allowedLocations: ['exampleville', 'examplia north'],
  allowedProvinces: [],
  keepRemote: true,
  keepGenericItaly: true,
  countryNames: ['italia', 'italy'],
};
const at = (location: string, extra: { title?: string; remote?: boolean } = {}) =>
  locationPasses({ title: extra.title ?? 'Developer', location, remote: extra.remote }, filter);

void test('an allowed place passes, in any case and inside a longer address', () => {
  assert.equal(at('Exampleville, EV, Italia'), true);
  assert.equal(at('EXAMPLIA NORTH'), true);
});

void test('a place abroad is dropped, even for a remote role', () => {
  assert.equal(at('Berlin, Germany'), false);
  assert.equal(at('Berlin, Germany', { remote: true, title: 'Remote developer' }), false);
});

void test('Italy with no precise place is kept while keepGenericItaly is on', () => {
  assert.equal(at('Italia'), true);
  assert.equal(at('Italy'), true);
  assert.equal(at(''), true);
  assert.equal(
    locationPasses({ title: 'Developer', location: 'Italia' }, { ...filter, keepGenericItaly: false }),
    false,
  );
});

void test('another city in the country passes only as a remote role', () => {
  assert.equal(at('Otherville, OV, Italia'), false);
  assert.equal(at('Otherville, OV, Italia', { remote: true }), true);
  assert.equal(at('Otherville, OV, Italia', { title: 'Sviluppatore full remote' }), true);
  assert.equal(at('Otherville, OV, Italia', { title: 'Programmatore in smart working' }), true);
  assert.equal(
    locationPasses({ title: 'Remoto', location: 'Otherville, Italia', remote: true }, { ...filter, keepRemote: false }),
    false,
  );
});

void test('only the highest location bonus counts', () => {
  const weights = { exampleville: 3, examplia: 1 };
  assert.deepEqual(locationBonus('Exampleville, EV, Examplia', weights), {
    bonus: 3,
    reasons: ['exampleville:+3 (sede)'],
  });
  assert.deepEqual(locationBonus('Otherville, Examplia', weights), { bonus: 1, reasons: ['examplia:+1 (sede)'] });
  assert.deepEqual(locationBonus('Otherville', weights), { bonus: 0, reasons: [] });
});

void test('a short region code on the list matches only as a whole word', () => {
  const coded = { ...filter, allowedLocations: ['ev'] };
  assert.equal(locationPasses({ title: 'Developer', location: 'Otherville, EV, Italy' }, coded), true);
  assert.equal(locationPasses({ title: 'Developer', location: 'Levanto, LI, Italy' }, coded), false);
});

void test('P2 province accepts its towns including accent variants, but not other provinces', () => {
  const to = { ...filter, allowedProvinces: ['TO'] };
  for (const place of ["Cuorgne'", 'Cuorgnè', 'Pino Torinese', 'Rivarolo Canavese', 'Mappano']) {
    assert.equal(locationPasses({ title: 'Developer', location: place }, to), true, place);
    assert.equal(locationPasses({ title: 'Developer', location: place }, filter), false, place);
  }
  for (const place of ['Asti', 'Acqui Terme', 'Verbania']) {
    assert.equal(locationPasses({ title: 'Developer', location: place }, to), false, place);
    assert.equal(locationPasses({ title: 'Developer', location: place }, filter), false, place);
  }
});

void test('P3 matches complete comma- or dash-separated parts, not fragments', () => {
  const to = { ...filter, allowedProvinces: ['TO'] };
  for (const place of ['Ivrea, Piemonte', 'Rivarolo Canavese - TO'])
    assert.equal(locationPasses({ title: 'Developer', location: place }, to), true, place);
  for (const place of ['Ivrealand', 'Super Ivrea', 'Rivarolo Canavesex'])
    assert.equal(locationPasses({ title: 'Developer', location: place }, to), false, place);
});

void test('hyphens inside an ISTAT town name remain part of the name', () => {
  const no = { ...filter, allowedProvinces: ['NO'] };
  assert.equal(locationPasses({ title: 'Developer', location: 'Gattico-Veruno' }, no), true);
  assert.equal(locationPasses({ title: 'Developer', location: 'Gattico-Veruno - NO' }, no), true);
});

void test('place names matching object prototype properties do not throw', () => {
  for (const place of ['constructor', '__proto__']) assert.equal(at(place), false);
});

void test('a typographic apostrophe inside a town name matches the ISTAT spelling', () => {
  const to = { ...filter, allowedProvinces: ['TO'] };
  assert.equal(locationPasses({ title: 'Developer', location: 'Sant’Ambrogio di Torino' }, to), true);
  assert.equal(locationPasses({ title: 'Developer', location: 'Sant’Antonino di Susa' }, to), true);
});

void test('L3 a town with a province but no region passes when its region is allowed', () => {
  const regional = { ...filter, allowedLocations: ['piemonte'], keepGenericItaly: false };
  const where = (location: string) => locationPasses({ title: 'Developer', location }, regional);
  assert.equal(where('CAVAGLIA, BIELLA'), true);
  assert.equal(where('Fossano e Revello, Cuneo'), true);
  assert.equal(where('Brescia'), false);
  assert.equal(where('Cavaglia, Biella, Italia'), true);
  assert.equal(
    locationPasses(
      { title: 'Developer', location: 'Trento' },
      { ...regional, allowedLocations: ['Trentino Alto Adige'] },
    ),
    true,
  );
});

void test('every province in the ISTAT data has a region', () => {
  for (const provinces of Object.values(provinceTowns))
    for (const province of provinces) assert.ok(provinceRegion[province], province);
  assert.equal(Object.keys(provinceRegion).length, 107);
});
