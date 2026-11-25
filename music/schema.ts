import { integer, sqliteTable, text } from '../../apps/server/src/core/module-db.ts';

export const history = sqliteTable('history', {
  id: text('id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  /** The artwork URL the song had when it played; the cover itself is fetched through the proxy, never stored. */
  cover: text('cover'),
  playedAt: integer('played_at').notNull(),
});

export const favorites = sqliteTable('favorites', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  addedAt: integer('added_at').notNull(),
});

export const playlists = sqliteTable('playlists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const playlistSongs = sqliteTable('playlist_songs', {
  playlistId: integer('playlist_id')
    .notNull()
    .references(() => playlists.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  id: text('id').notNull(),
  title: text('title').notNull(),
  artist: text('artist').notNull(),
  addedAt: integer('added_at').notNull(),
});

/** Key-value settings of the module; today only the remembered music volume. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: integer('value').notNull(),
});

/** The radio or playlist queue (one row, id 1), so a restart of Hub picks up the music mpv is still playing. */
export const queueState = sqliteTable('queue_state', {
  id: integer('id').primaryKey(),
  value: text('value').notNull(),
});
