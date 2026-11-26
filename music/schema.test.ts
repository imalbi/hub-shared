import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import { playlistSongs } from './schema.ts';

void test('playlist migration preserves duplicate songs and gives each row a persistent unique identity', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'music-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const migrations = fileURLToPath(new URL('./drizzle', import.meta.url));
  const directories = (await readdir(migrations)).toSorted();
  for (const dir of directories.slice(0, -1))
    await cp(join(migrations, dir), join(root, 'old', dir), { recursive: true });
  const path = join(root, 'music.db');
  const old = openDatabase(path, join(root, 'old'));
  old.$client.exec("INSERT INTO playlists (id, name, created_at) VALUES (1, 'Fixture', 1)");
  old.$client.exec(
    "INSERT INTO playlist_songs (playlist_id, position, id, title, artist, added_at) VALUES (1, 0, 'abcdefghijk', 'Same', 'Artist', 1), (1, 1, 'abcdefghijk', 'Same', 'Artist', 1)",
  );
  old.$client.close();
  const db = openDatabase(path, migrations);
  const rows = db.select().from(playlistSongs).all();
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.itemId)).size, 2);
  assert.deepEqual(
    rows.map((row) => [row.position, row.id]),
    [
      [0, 'abcdefghijk'],
      [1, 'abcdefghijk'],
    ],
  );
  db.$client.close();
  const reopened = openDatabase(path, migrations);
  t.after(() => reopened.$client.close());
  assert.deepEqual(reopened.select().from(playlistSongs).all(), rows);
});
