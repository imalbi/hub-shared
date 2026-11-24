import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atsProblems, expectationFromTex } from './ats-text.ts';

const expected = {
  email: 'jane@example.org',
  phone: '+39 000 000 0000',
  headings: ['Profilo', 'Esperienza', 'Competenze'],
};
const good = `Jane Doe\njane@example.org | +39 000 000 0000\nProfilo\nText\nEsperienza\nAgosto 2025 - Agosto 2026\nCompetenze\nTypeScript\n`;

void test('a clean text passes', () => assert.deepEqual(atsProblems(good, expected), []));

void test('an email split by a glyph fails naming the email', () => {
  const split = good.replace('jane@example.org', 'jane@example.org');
  const problems = atsProblems(split, expected);
  assert.ok(problems.some((p) => p.startsWith('email')));
});

void test('a missing phone fails naming the phone', () => {
  const problems = atsProblems(good.replace('+39 000 000 0000', ''), expected);
  assert.deepEqual(
    problems.map((p) => p.split(' ')[0]),
    ['phone'],
  );
});

void test('a private-use character fails', () => {
  const problems = atsProblems(`${good} icon`, expected);
  assert.ok(problems.some((p) => p.startsWith('private-use')));
});

void test('headings out of order fail on heading order', () => {
  const swapped = good.replace('Esperienza', 'XX').replace('Competenze', 'Esperienza').replace('XX', 'Competenze');
  const problems = atsProblems(swapped, expected);
  assert.ok(problems.some((p) => p.startsWith('heading order')));
});

void test('a year joined to an en dash fails and the ASCII form passes', () => {
  assert.ok(atsProblems(good.replace('2025 - Agosto', '2025 – Agosto'), expected).length > 0);
  assert.ok(atsProblems(good.replace('Agosto 2025 - Agosto 2026', '2025 – 2026'), expected).length > 0);
  assert.deepEqual(atsProblems(good.replace('Agosto 2025 - Agosto 2026', '2025 - 2026'), expected), []);
});

void test('contacts and headings come from the source', () => {
  const tex = String.raw`\href{mailto:jane@example.org}{jane@example.org}\sep \href{tel:+390000000000}{+39 000 000 0000}
\section*{Profilo}
\section{Esperienza}`;
  assert.deepEqual(expectationFromTex(tex), {
    email: 'jane@example.org',
    phone: '+39 000 000 0000',
    headings: ['Profilo', 'Esperienza'],
  });
  assert.throws(() => expectationFromTex('no links'), /mailto/);
  // A source with no phone asks for the email only.
  const noPhone = expectationFromTex(String.raw`\href{mailto:jane@example.org}{jane@example.org}`);
  assert.equal(noPhone.phone, null);
  assert.deepEqual(atsProblems(good.replace('+39 000 000 0000', ''), noPhone), []);
});
