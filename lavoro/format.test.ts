import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSnippet,
  extractExperience,
  formatCollectionLabel,
  formatJobTitle,
  formatWorkMode,
  highlightHtmlText,
} from './format.ts';

void test('formatCollectionLabel formats today, yesterday, older date, and null cleanly', () => {
  const now = new Date(2026, 10, 20, 14, 0).getTime();
  const todayMorning = new Date(2026, 10, 20, 9, 5).getTime();
  const yesterdayEvening = new Date(2026, 10, 19, 18, 30).getTime();
  const olderDay = new Date(2026, 10, 7, 12, 0).getTime();

  assert.equal(formatCollectionLabel(null, now), null);
  assert.equal(formatCollectionLabel(todayMorning, now), 'raccolta oggi 09:05');
  assert.equal(formatCollectionLabel(todayMorning, now, true), 'raccolta 09:05');
  assert.equal(formatCollectionLabel(yesterdayEvening, now), 'raccolta ieri 18:30');
  assert.equal(formatCollectionLabel(yesterdayEvening, now, true), 'raccolta ieri');
  assert.match(formatCollectionLabel(olderDay, now) ?? '', /^raccolta 7 nov$/);
  assert.match(formatCollectionLabel(olderDay, now, true) ?? '', /^raccolta 7 nov$/);
});

void test('formatJobTitle normalizes ALL CAPS titles to Title Case while preserving acronyms', () => {
  assert.equal(formatJobTitle('TECNICO MANUTENTORE / FRIGORISTA'), 'Tecnico Manutentore / Frigorista');
  assert.equal(
    formatJobTitle('SENIOR FRONTEND DEVELOPER (REACT / NEXT.JS)'),
    'Senior Frontend Developer (React / Next.js)',
  );
  assert.equal(formatJobTitle('PROGRAMMATORE PLC E AUTOMAZIONE'), 'Programmatore PLC E Automazione');
  assert.equal(formatJobTitle('FULLSTACK DEVELOPER PHP / SQL'), 'Fullstack Developer PHP / SQL');
});

void test('formatJobTitle preserves already mixed-case titles', () => {
  assert.equal(formatJobTitle('Frontend Developer React'), 'Frontend Developer React');
  assert.equal(formatJobTitle('Web Developer Junior'), 'Web Developer Junior');
  assert.equal(formatJobTitle(''), '');
});

void test('formatWorkMode converts raw mode tokens to Italian labels', () => {
  assert.equal(formatWorkMode('remote'), 'Remoto');
  assert.equal(formatWorkMode('hybrid'), 'Ibrido');
  assert.equal(formatWorkMode('onsite'), 'In sede');
  assert.equal(formatWorkMode('Remoto'), 'Remoto');
  assert.equal(formatWorkMode(null), undefined);
  assert.equal(formatWorkMode(undefined), undefined);
});

void test('cleanSnippet normalizes whitespace and line breaks', () => {
  assert.equal(cleanSnippet('  Hello   world \n\n new line  '), 'Hello world new line');
  assert.equal(cleanSnippet(''), '');
  assert.equal(cleanSnippet(null), '');
});

void test('extractExperience extracts years and optional domain from job descriptions', () => {
  assert.equal(
    extractExperience('4–5 anni di esperienza in Data Science, con progetti portati in produzione.'),
    '4-5 anni Data Science',
  );
  assert.equal(extractExperience('Richiesti almeno 3 anni di esperienza con React e Node.'), '3 anni React e Node');
  assert.equal(extractExperience('Esperienza minima di 2 anni in sviluppo backend.'), '2 anni sviluppo backend');
  assert.equal(extractExperience('5+ years of experience in Python.'), '5+ anni Python');
  assert.equal(extractExperience('5–10 years of professional experience working with code'), '5-10 anni code');
  assert.equal(
    extractExperience(
      'Almeno 2-4 anni di esperienza in aziende enterprise strutturate (grandi organizzazioni con processi di sviluppo, rilascio e governance IT formalizzati)',
    ),
    '2-4 anni enterprise',
  );
  assert.equal(extractExperience('con almeno 2/3 anni di esperienza'), '2-3 anni exp');
  assert.equal(
    extractExperience(`
ESPRIMO Srl, società di consulenza informatica...
Frontend Developer con almeno 2/3 anni di esperienza
Requisiti
Almeno 2-4 anni di esperienza in aziende enterprise strutturate
`),
    '2-4 anni enterprise',
  );
  assert.equal(extractExperience('1-2 anni di esperienza.'), '1-2 anni exp');
  assert.equal(
    extractExperience('Azienda leader da oltre 20 anni nel settore. Richiesti 3 anni di esperienza.'),
    '3 anni exp',
  );
  assert.equal(extractExperience('Nessuna esperienza richiesta.'), null);
  assert.equal(extractExperience(null), null);
});

const skill = (text: string) => ({ text, mark: 'skill' as const });

void test('highlightHtmlText marks matching terms in text nodes with a data-mark span, tags untouched', () => {
  const input = '<p>Cerchiamo un profilo <strong>React</strong> con esperienza.</p>';
  const output = highlightHtmlText(input, [skill('React')]);
  assert.equal(
    output,
    '<p>Cerchiamo un profilo <strong><span data-mark="skill">React</span></strong> con esperienza.</p>',
  );
  assert.equal(highlightHtmlText('', [skill('React')]), '');
  assert.equal(highlightHtmlText(input, []), input);
});

void test('highlightHtmlText gives each word the kind of its term and the longest term wins', () => {
  const output = highlightHtmlText('<p>Laurea richiesta, 1.800 euro, tempo indeterminato e tempo pieno.</p>', [
    { text: 'laurea', mark: 'exclude' },
    { text: '1.800', mark: 'salary' },
    { text: 'tempo', mark: 'skill' },
    { text: 'tempo indeterminato', mark: 'contract' },
  ]);
  assert.equal(
    output,
    '<p><span data-mark="exclude">Laurea</span> richiesta, <span data-mark="salary">1.800</span> euro, <span data-mark="contract">tempo indeterminato</span> e <span data-mark="skill">tempo</span> pieno.</p>',
  );
  assert.ok(!output.includes('<mark'));
});

void test('highlightHtmlText never lands inside a tag, an attribute or an HTML entity', () => {
  assert.equal(highlightHtmlText('<p>Tom &amp; Jerry</p>', [skill('amp')]), '<p>Tom &amp; Jerry</p>');
  assert.equal(
    highlightHtmlText('<a href="https://x.example/react" title="react">link</a>', [skill('react')]),
    '<a href="https://x.example/react" title="react">link</a>',
  );
});

void test('highlightHtmlText leaves section titles alone unless a term names them', () => {
  const html = '<h3>Requisiti</h3><p>Chi cerchiamo: React</p>';
  assert.equal(
    highlightHtmlText(html, [skill('React')]),
    '<h3>Requisiti</h3><p>Chi cerchiamo: <span data-mark="skill">React</span></p>',
  );
});

void test('highlightHtmlText matches whole words only and preserves currency or symbol prefixes', () => {
  const html = '<p>Area IT: requisiti, attività, capacità, identità, monitorare, titolo e encourage.</p>';
  assert.equal(
    highlightHtmlText(html, [skill('IT'), skill('RAG')]),
    '<p>Area <span data-mark="skill">IT</span>: requisiti, attività, capacità, identità, monitorare, titolo e encourage.</p>',
  );
  assert.equal(
    highlightHtmlText('<p>soluzioni IT e sistemi RAG con .NET e React</p>', [skill('IT'), skill('RAG'), skill('.NET')]),
    '<p>soluzioni <span data-mark="skill">IT</span> e sistemi <span data-mark="skill">RAG</span> con <span data-mark="skill">.NET</span> e React</p>',
  );
  assert.equal(
    highlightHtmlText('<p>Starting at €42,000 - based on experience</p>', [{ text: '€42,000', mark: 'salary' }]),
    '<p>Starting at <span data-mark="salary">€42,000</span> - based on experience</p>',
  );
});
