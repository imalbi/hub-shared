import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dirtyResourceDraft, observeResourceDraft, savedResourceDraft } from './resource-draft.ts';

void test('resource drafts retain edits on concurrent reads and never revert a successful save to an older snapshot', () => {
  const initial = { title: 'Capitolo', body: 'Uno', revision: 1 };
  const clean = savedResourceDraft(initial);
  const dirty = { ...clean, body: 'Locale' };
  const remote = { ...initial, body: 'Remoto', revision: 2 };
  const conflict = observeResourceDraft(dirty, remote);
  assert.equal(conflict.body, 'Locale');
  assert.equal(conflict.saved.revision, 1);
  assert.equal(conflict.server.revision, 2);
  assert.ok(dirtyResourceDraft(conflict));
  const saved = savedResourceDraft({ ...initial, body: 'Locale', revision: 3 });
  assert.equal(observeResourceDraft(saved, remote), saved);
  assert.equal(dirtyResourceDraft(saved), false);
  assert.equal(observeResourceDraft(clean, remote).body, 'Remoto');
});
