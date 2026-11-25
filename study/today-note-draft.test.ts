import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDraft } from './today-note-draft.ts';

void test('a clean cached note adopts newer server text before another edit', () => {
  const draft = getDraft('clean', 'first');
  assert.equal(getDraft('clean', 'from another client'), draft);
  assert.equal(draft.text, 'from another client');
  assert.equal(draft.saved, 'from another client');
});
void test('new server text cannot overwrite unsaved, failed or pending edits', () => {
  for (const state of ['dirty', 'failed', 'pending']) {
    const draft = getDraft(state, 'first');
    draft.text = 'local edit';
    if (state !== 'dirty') draft.saved = draft.text;
    draft.failed = state === 'failed';
    draft.pending = state === 'pending';
    assert.equal(getDraft(state, 'remote').text, 'local edit');
    assert.equal(draft.saved, state === 'dirty' ? 'first' : 'local edit');
  }
});

void test('a successful local save survives the previous server snapshot', () => {
  const draft = getDraft('saved', 'previous');
  draft.text = 'saved locally';
  draft.saved = draft.text;
  assert.equal(getDraft('saved', 'previous').text, 'saved locally');
  assert.equal(getDraft('saved', 'saved locally').text, 'saved locally');
});
