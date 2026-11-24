import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { texProblems } from './tex-check.ts';

const cleanDoc = String.raw`\documentclass[10pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\begin{document}
Hello world, 50\% growth.
\end{document}
`;

void test('clean document with template preamble passes', () => {
  assert.deepEqual(texProblems(cleanDoc, cleanDoc), []);
});

void test('lettera.tex template passes', async () => {
  const template = await readFile(new URL('../candidatura/lettera.tex', import.meta.url), 'utf8');
  assert.deepEqual(texProblems(template, template), []);
});

void test('rejects dangerous TeX primitives in body', () => {
  const cases = [
    String.raw`\input{/etc/passwd}`,
    String.raw`\input /etc/passwd`,
    String.raw`\include{secret}`,
    String.raw`\openin0=/etc/passwd`,
    String.raw`\openout0=out.txt`,
    String.raw`\write18{id}`,
    String.raw`\immediate\write18{id}`,
    String.raw`\catcode\`\@=11`,
    String.raw`\scantokens{\input{a}}`,
    String.raw`\csname input\endcsname`,
  ];
  for (const snippet of cases) {
    const injected = cleanDoc.replace('Hello world', snippet);
    const problems = texProblems(injected, cleanDoc);
    assert.ok(problems.length > 0, `expected failure for ${snippet}`);
  }
});

void test('ignores TeX comments but still catches unescaped commands after \\%', () => {
  const commented = cleanDoc.replace('Hello world', String.raw`% \input{/etc/passwd}`);
  assert.deepEqual(texProblems(commented, cleanDoc), []);

  const afterPercent = cleanDoc.replace('Hello world', String.raw`50\% \input{/etc/passwd}`);
  assert.ok(texProblems(afterPercent, cleanDoc).some((p) => p.includes('\\input')));
});

void test('rejects modified preamble when template is supplied', () => {
  const modified = cleanDoc.replace(
    String.raw`\usepackage[utf8]{inputenc}`,
    String.raw`\usepackage[utf8]{inputenc}\n\input{extra}`,
  );
  const problems = texProblems(modified, cleanDoc);
  assert.ok(problems.some((p) => p.includes('preamble differs')));
  assert.ok(problems.some((p) => p.includes('\\input')));
});
