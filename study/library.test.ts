import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFiles } from '../../apps/server/src/core/files.ts';
import { createMaterialOpener } from './library.ts';

void test('cold concurrent PDF opens share storage and expired copies can be reopened', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-material-'));
  const files = createFiles({ maxEntries: 1 });
  t.after(async () => {
    await files.close();
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, 'lesson.pdf'), 'PDF');
  const open = createMaterialOpener([root]);
  const opened = await Promise.all(Array.from({ length: 4 }, () => open(files, 'lesson.pdf')));
  assert.equal(new Set(opened.map((file) => file.fileId)).size, 1);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 3_600_001);
  const reopened = await open(files, 'lesson.pdf');
  assert.notEqual(reopened.fileId, opened[0]?.fileId);
  assert.equal((await files.read(reopened.fileId)).toString(), 'PDF');
});

void test('oversized PDFs are refused before copying and failures do not poison the cache', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-material-'));
  const files = createFiles();
  t.after(async () => {
    await files.close();
    await rm(root, { recursive: true, force: true });
  });
  const path = join(root, 'lesson.pdf');
  await writeFile(path, 'PDF');
  await truncate(path, 100 * 1024 * 1024 + 1);
  const open = createMaterialOpener([root]);
  await assert.rejects(open(files, 'lesson.pdf'), { code: 'PAYLOAD_TOO_LARGE' });
  await writeFile(path, 'PDF');
  const file = await open(files, 'lesson.pdf');
  assert.equal((await files.read(file.fileId)).toString(), 'PDF');
});
