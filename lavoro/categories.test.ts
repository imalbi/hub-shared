import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultCategories } from './config.ts';
import { categorize } from './categories.ts';

void test('a posting gets every category whose keywords appear as whole words, in the map order', () => {
  assert.deepEqual(categorize('Frontend developer', 'We use React and Docker.', defaultCategories), [
    'Frontend',
    'Cloud / DevOps',
  ]);
  assert.deepEqual(categorize('RAG engineer', 'LLM pipelines with embeddings', defaultCategories), ['RAG', 'AI / LLM']);
});

void test('a substring of another word is not a hit', () => {
  assert.deepEqual(categorize('Storage technician', 'Fragile goods', defaultCategories), []);
});

void test('a custom map replaces the default one', () => {
  assert.deepEqual(categorize('Barista', 'Espresso machine', { Bar: ['barista'], Kitchen: ['chef'] }), ['Bar']);
});
