import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comparisonCompany, comparisonKey, postingKey } from './key.ts';

void test('the stored key is company and title, lowercased, with runs of separators collapsed', () => {
  assert.equal(
    postingKey('Acme  Labs', 'Sviluppatore   Front-End (TypeScript)'),
    'acme labs|sviluppatore front end typescript',
  );
});

void test('accents stay in the stored key and are not split like an ASCII \\W would', () => {
  assert.equal(postingKey('Società Forlì', 'Responsabile Qualità'), 'società forlì|responsabile qualità');
});

void test('the stored key keeps the legal form and accents that the comparison key drops', () => {
  assert.equal(postingKey('Acme S.r.l.', 'Sviluppatore Forlì'), 'acme s r l|sviluppatore forlì');
  assert.equal(comparisonKey('Acme S.r.l.', 'Sviluppatore Forlì'), 'acme|forli sviluppatore');
});

void test('the comparison key sees one posting behind different legal forms and accents', () => {
  const same = [
    comparisonKey('ACME SRL', 'sviluppatore forli'),
    comparisonKey('Acme s.r.l.s.', 'Sviluppatore Forlì'),
    comparisonKey('Acme, Inc.', 'Sviluppatore Forlì'),
    comparisonKey('Acme GmbH', 'Sviluppatore Forlì'),
    comparisonKey('Acme', 'Sviluppatore Forlì'),
  ];
  assert.equal(new Set(same).size, 1);
  assert.notEqual(comparisonKey('Acme', 'Sviluppatore'), comparisonKey('Acme', 'Sviluppatrice'));
});

void test('a name made only of a legal form keeps it, and a form inside the name is not removed', () => {
  assert.equal(comparisonKey('S.p.A.', 'Analista'), 'spa|analista');
  assert.equal(comparisonKey('Sa Mobile Ltd', 'Analista'), 'sa mobile|analista');
});

void test('the comparison key sees one company behind a staffing agency, a group prefix or a parenthesis', () => {
  const names = ['Iren', 'Iren Spa', 'Iren tramite Synergie', 'Iren (IRETI via Synergie)'];
  assert.equal(new Set(names.map(comparisonCompany)).size, 1);
  const gecal = [
    'Gruppo Gecal Informatica - Altair Systems',
    'Gecal Informatica Srl',
    'Gecal Informatica (Altair Systems)',
  ];
  assert.equal(new Set(gecal.map(comparisonCompany)).size, 1);
  assert.notEqual(comparisonCompany('Iren'), comparisonCompany('Irene'));
});

void test('the comparison key ignores word order, gender marks and reference codes in a title', () => {
  const same = [
    comparisonKey('Iren', 'Addetto/a junior manutenzione elettrica'),
    comparisonKey('Iren', 'Addetto/a manutenzione elettrica junior'),
    comparisonKey('Iren', 'Addetto manutenzione elettrica junior (Rif. 12)'),
  ];
  assert.equal(new Set(same).size, 1);
  assert.equal(
    comparisonKey('Iren', 'Tecnico per la Gestione delle Reti'),
    comparisonKey('Iren', 'Tecnico Gestione Reti'),
  );
});

void test('a title keeps what tells two postings apart', () => {
  assert.notEqual(
    comparisonKey('Acme', 'Addetto manutenzione elettrica junior'),
    comparisonKey('Acme', 'Addetto manutenzione elettrica'),
  );
  assert.notEqual(comparisonKey('Acme', 'Developer (Java)'), comparisonKey('Acme', 'Developer (React)'));
  assert.notEqual(
    comparisonKey('Acme', 'Tecnico impianti elettrici'),
    comparisonKey('Acme', 'Tecnico impianti termici'),
  );
});

void test('a trailing place in brackets does not split one posting from its application', () => {
  assert.equal(
    comparisonKey('Energia Esempio Spa', 'Tecnico per la Gestione delle Reti Elettriche (Forlì)', 'Forlì, FC, Italy'),
    comparisonKey('Energia Esempio tramite Agenzia Esempio', 'Tecnico Gestione Reti Elettriche'),
  );
  assert.equal(
    comparisonKey('Acme', 'Sviluppatore (ibrido Forlì / Milano / Full remote)'),
    comparisonKey('Acme', 'Sviluppatore'),
  );
});

void test('a bracket that is not the place of the posting still tells two postings apart', () => {
  assert.notEqual(comparisonKey('Acme', 'Sviluppatore (Junior)'), comparisonKey('Acme', 'Sviluppatore (Senior)'));
  assert.notEqual(comparisonKey('Acme', 'Sviluppatore (Forlì)', 'Milano'), comparisonKey('Acme', 'Sviluppatore'));
});
