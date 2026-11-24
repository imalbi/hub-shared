import { deepStrictEqual } from 'node:assert';
import { test } from 'node:test';
import { parseMarkdown } from './markdown.ts';

void test('parses the interview note structure and safe inline formatting', () => {
  deepStrictEqual(
    parseMarkdown(
      '# Colloquio\n\n**In breve**\n- **Fase:** tecnica\n- Usa `codice` e [guida](https://example.com)\n\n---\n\n## Domande\n\n### 1. Domanda\nRispondi con un esempio.\n\n<sub>Fonte: cv.tex:53</sub>',
    ),
    [
      { type: 'heading', level: 1, runs: [{ text: 'Colloquio' }] },
      { type: 'paragraph', runs: [{ text: 'In breve', bold: true }] },
      {
        type: 'list',
        items: [
          [{ text: 'Fase:', bold: true }, { text: ' tecnica' }],
          [
            { text: 'Usa ' },
            { text: 'codice', code: true },
            { text: ' e ' },
            { text: 'guida', href: 'https://example.com' },
          ],
        ],
      },
      { type: 'rule' },
      { type: 'heading', level: 2, runs: [{ text: 'Domande' }] },
      { type: 'heading', level: 3, runs: [{ text: '1. Domanda' }] },
      { type: 'paragraph', runs: [{ text: 'Rispondi con un esempio.' }] },
      { type: 'source', runs: [{ text: 'Fonte: cv.tex:53' }] },
    ],
  );
});

void test('keeps HTML and unsafe links as text', () => {
  deepStrictEqual(parseMarkdown('<img src=x> [click](javascript:alert)'), [
    { type: 'paragraph', runs: [{ text: '<img src=x> [click](javascript:alert)' }] },
  ]);
});
