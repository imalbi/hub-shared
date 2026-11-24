import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keywordPattern, scoreKeywords } from './match.ts';

const weights = { rag: 5, senior: -4, 'react native': 3, '.net': -4, 'node.js': 3 };

void test('a keyword is a whole word: rag finds RAG and a plural, never storage', () => {
  assert.equal(scoreKeywords('RAG engineer', weights).score, 5);
  assert.equal(scoreKeywords('Building RAGs', weights).score, 5);
  assert.equal(scoreKeywords('Storage engineer', weights).score, 0);
  assert.equal(scoreKeywords('Fragile systems', weights).score, 0);
});

void test('accented letters are letters at a word boundary, not separators', () => {
  assert.equal(keywordPattern('rag').test('caffè rag'), true);
  assert.equal(keywordPattern('rag').test('èrag'), false);
  assert.equal(keywordPattern('rag').test('ragù'), false);
  assert.equal(keywordPattern('forlì').test('Sviluppatore a Forlì, FC'), true);
  assert.equal(keywordPattern('società').test('Società di consulenza'), true);
});

void test('each keyword counts once and the reasons carry the sign and the tag', () => {
  const found = scoreKeywords('Senior RAG engineer, rag rag, senior', weights, ' (descr.)');
  assert.equal(found.score, 1);
  assert.deepEqual(found.reasons, ['rag:+5 (descr.)', 'senior:-4 (descr.)']);
});

void test('phrases and keywords with punctuation match literally', () => {
  assert.equal(scoreKeywords('React Native developer', weights).score, 3);
  assert.equal(scoreKeywords('Node.js developer', weights).score, 3);
  assert.equal(scoreKeywords('Nodexjs developer', weights).score, 0);
  assert.equal(scoreKeywords('Sviluppatore .NET', weights).score, -4);
});

void test('Rag. is also an accountant: the bare word cannot tell, so the profile weighs the accounting words down', () => {
  const trap = { rag: 5, contabile: -8 };
  assert.equal(scoreKeywords('Rag. Contabile', trap).score, -3);
  assert.equal(scoreKeywords('RAG Engineer', trap).score, 5);
});

void test('uppercase gendered title gets the addetto weight', () => {
  assert.equal(scoreKeywords('ADDETTO/A esempio', { addetto: 2 }).score, 2);
});
