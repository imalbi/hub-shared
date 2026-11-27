import assert from 'node:assert/strict';
import { test } from 'node:test';
import { technicalDescription, differentDescription } from './dedupe-fixture.ts';
import { descriptionSimilarity, fingerprint } from './similarity.ts';

void test('three-shingle similarity tolerates headers but separates unrelated work', () => {
  assert.equal(descriptionSimilarity(technicalDescription, technicalDescription), 1);
  assert.ok(descriptionSimilarity('Nuova opportunità. ' + technicalDescription, technicalDescription) >= 0.78);
  assert.ok(descriptionSimilarity(technicalDescription, differentDescription) <= 0.25);
  assert.equal(descriptionSimilarity('short', technicalDescription), 0);
  assert.equal(descriptionSimilarity(technicalDescription, ''), 0);
});
void test('fingerprints normalize accents and punctuation and cap input at 400 tokens', () => {
  assert.deepEqual(fingerprint('Qualità, società ELETTRICA', 1), fingerprint('qualita societa elettrica', 1));
  const prefix = Array.from({ length: 400 }, (_, n) => 'word' + n).join(' ');
  assert.deepEqual(fingerprint(prefix + ' ignored tail words', 1), fingerprint(prefix, 1));
  assert.equal(descriptionSimilarity('x '.repeat(200), 'x '.repeat(200)), 0);
});
