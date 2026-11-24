import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkModeResolver, type ModeSource } from './work-mode.ts';

const none = { remote: [], hybrid: [], onsite: [] };
const resolve = createWorkModeResolver(none);
const mode = (source: Partial<ModeSource>) => resolve({ title: 'Developer', location: 'Exampleville', ...source });

void test('what the source declares wins over everything in the text', () => {
  assert.equal(mode({ declared: 'hybrid', title: 'Full remote developer' }), 'hybrid');
  assert.equal(mode({ declared: 'onsite', description: 'Lavoro 100% remoto' }), 'onsite');
});

void test('title and location tell hybrid, remote and on-site', () => {
  assert.equal(mode({ title: 'Sviluppatore ibrido' }), 'hybrid');
  assert.equal(mode({ location: 'Exampleville (hybrid)' }), 'hybrid');
  assert.equal(mode({ title: 'Full remote developer' }), 'remote');
  assert.equal(mode({ title: 'Sviluppatore in telelavoro' }), 'remote');
  assert.equal(mode({ title: 'Sviluppatore in sede' }), 'onsite');
  assert.equal(mode({ location: 'Exampleville, on-site' }), 'onsite');
});

void test('hybrid cloud is an architecture, not a way of working', () => {
  assert.equal(mode({ title: 'Hybrid cloud engineer' }), null);
  assert.equal(mode({ title: 'Engineer, hybrid infrastructure' }), null);
  assert.equal(mode({ title: 'Hybrid engineer' }), 'hybrid');
});

void test('the description counts when the title and place say nothing', () => {
  assert.equal(mode({ description: 'Modalità di lavoro: ibrido, 2 giorni a settimana in ufficio.' }), 'hybrid');
  assert.equal(mode({ description: 'We offer a hybrid role with two days a week in the office.' }), 'hybrid');
  assert.equal(mode({ description: 'Lavoro in IBRIDO SU TORINO' }), 'hybrid');
  assert.equal(mode({ description: 'Smart working e work-life balance' }), 'hybrid');
  assert.equal(mode({ description: 'La posizione è 100% remoto.' }), 'remote');
  assert.equal(mode({ description: 'Sede operativa: Remoto' }), 'remote');
  assert.equal(mode({ description: 'Smart working al 100% da remoto' }), 'remote');
  assert.equal(mode({ description: 'Opportunity to work remotely within Europe' }), 'remote');
  assert.equal(mode({ description: 'Il lavoro si svolge presso la nostra sede.' }), 'onsite');
});

// 16n2 step 0: a template line some manual jobs carry. It names a city and offers some remote work, so it is hybrid;
// reading only "da remoto" let on-site jobs far from the allowed places past the location filter.
void test('"Ibrido/da remoto" is hybrid, whichever way round and wherever the line sits', () => {
  assert.equal(mode({ description: 'Sede di lavoro: Ibrido/da remoto (10098 Exampleville)' }), 'hybrid');
  assert.equal(mode({ description: 'Sede di lavoro: Da remoto / ibrido (Exampleville, Examplia)' }), 'hybrid');
  assert.equal(
    mode({ description: 'Sede di lavoro: Ibrido/da remoto (Exampleville)\nRetribuzione: 1.800 €' }),
    'hybrid',
  );
  assert.equal(mode({ description: 'Sede di lavoro: da remoto' }), 'remote', 'a plain remote line still reads remote');
});

void test('the order is: declared, hybrid, remote in the title, on-site in the title, then the description', () => {
  assert.equal(mode({ title: 'Remote developer', description: 'Hybrid role' }), 'hybrid');
  assert.equal(mode({ title: 'Remote developer in sede' }), 'remote');
  assert.equal(mode({ title: 'Developer in sede', description: 'Full remote' }), 'onsite');
  assert.equal(mode({ description: 'Full remote, ma anche in sede a volte' }), 'remote');
});

void test('a negation in the 80 characters before a match cancels it, unless a sentence ends in between', () => {
  assert.equal(mode({ description: 'Non è previsto il full remote.' }), null);
  assert.equal(mode({ description: 'Purtroppo senza possibilità di lavoro da remoto.' }), null);
  assert.equal(mode({ description: 'Not available as work from home.' }), null);
  assert.equal(mode({ description: 'Non è un lavoro noioso. Full remote dal primo giorno.' }), 'remote');
  assert.equal(mode({ title: 'No sales. Remote developer' }), 'remote');
  const far = `Non ${'x'.repeat(90)} full remote`;
  assert.equal(mode({ description: far }), 'remote', 'a negation further than 80 characters does not count');
});

void test('a negated match lets a later affirmed one decide once a sentence has ended', () => {
  assert.equal(mode({ description: 'Non è previsto il full remote. Si lavora in sede.' }), 'onsite');
});

void test('a comma is not a sentence break: the negation still reaches the next phrase (known limit of the 80-character rule)', () => {
  assert.equal(mode({ description: 'Non è previsto il full remote, ma si lavora in sede.' }), null);
});

void test('with no signal a city alone is unspecified, and the old remote flag is the last resort', () => {
  assert.equal(mode({}), null);
  assert.equal(mode({ remote: true }), 'remote');
  assert.equal(mode({ remote: true, description: 'Lavoro in sede' }), 'onsite');
});

void test('the profile adds phrases to the defaults and never replaces them', () => {
  const extended = createWorkModeResolver({ remote: ['lavoro agile totale'], hybrid: [], onsite: ['sul campo'] });
  const input = { title: 'Developer', location: 'Exampleville' };
  assert.equal(extended({ ...input, description: 'Previsto lavoro agile totale.' }), 'remote');
  assert.equal(extended({ ...input, description: 'Attività sul campo.' }), 'onsite');
  assert.equal(extended({ ...input, title: 'Full remote developer' }), 'remote');
  assert.equal(resolve({ ...input, description: 'Previsto lavoro agile totale.' }), null);
});
