import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { defineModule } from '../../../../../apps/server/src/core/module.ts';
import base, { createMusicModule } from '../../../server.ts';
export default defineModule({
  name: base.name,
  migrations: base.migrations,
  create(deps) {
    const musicEvents = new EventEmitter();
    const playlist: string[] = [];
    let position = -1;
    let stopped = false;
    let musicVolume = 100;
    return createMusicModule({
      youtube: {
        async searchPlaylists() {
          return [{ id: 'PLexample', title: 'Playlist pubblica' }];
        },
        async playlist() {
          return {
            title: 'Playlist pubblica',
            songs: [
              { id: '00000000000', title: 'Brano 1', artists: [{ name: 'Artista' }] },
              { id: '00000000001', title: 'Brano 2', artists: [{ name: 'Artista' }] },
            ],
          };
        },
        async artist() {
          return {
            name: 'Artista',
            banner: 'https://i.ytimg.com/banner',
            songs: [
              {
                id: '00000000000',
                title: 'Brano artista',
                artists: [{ name: 'Artista', id: 'UCabcdefghijklmnopqrstuv' }],
              },
            ],
            albums: [{ title: 'Disco esempio', cover: 'https://i.ytimg.com/album' }],
          };
        },
        async searchArtists() {
          return [{ id: 'UCabcdefghijklmnopqrstuv', name: 'Artista' }];
        },
        async relatedArtists() {
          return [
            { id: 'UC0000000000000000000001', name: 'Artista simile 1', cover: 'https://i.ytimg.com/similar-1' },
            { id: 'UC0000000000000000000002', name: 'Artista simile 2', cover: 'https://i.ytimg.com/similar-2' },
          ];
        },
        // No network in e2e: a recent song with no stored cover falls back to its video thumbnail.
        async cover(): Promise<string | undefined> {
          return undefined;
        },
        async upNext() {
          return [
            {
              id: '00000000001',
              title: 'Brano 2',
              artists: [{ name: 'Artista', id: 'UCabcdefghijklmnopqrstuv' }],
              seconds: 123,
            },
            { id: '00000000002', title: 'Brano 3', artists: [{ name: 'Artista' }], seconds: 123 },
            { id: '00000000003', title: 'Brano 4', artists: [{ name: 'Artista' }], seconds: 123 },
          ];
        },
        async search(query: string) {
          if (query === 'playlist-test')
            return {
              songs: [
                { id: 'playlist001', title: 'Mix 1', artists: [{ name: 'Artista' }] },
                { id: 'playlist002', title: 'Mix 2', artists: [{ name: 'Artista' }] },
              ],
              dropped: 0,
            };
          return {
            songs: Array.from({ length: 30 }, (_, i) => ({
              id: String(i).padStart(11, '0'),
              title: `Brano ${i + 1}`,
              artists: [{ name: 'Artista', id: 'UCabcdefghijklmnopqrstuv' }],
              seconds: 123,
            })),
            dropped: 0,
          };
        },
      },
      ipc: {
        events: musicEvents,
        async request(command) {
          if (command[0] === 'stop') stopped = true;
          if (command[0] === 'loadfile' && typeof command[1] === 'string') {
            stopped = false;
            if (command[2] === 'replace') {
              playlist.splice(0, playlist.length, command[1]);
              position = 0;
            } else playlist.push(command[1]);
          }
          if (command[0] === 'stop' || command[0] === 'playlist-clear') {
            if (command[0] === 'stop' && playlist.length)
              musicEvents.emit('event', { event: 'end-file', reason: 'stop' });
            playlist.splice(0, playlist.length);
            position = -1;
          }
          // mpv answers true once its playlist is empty; before the first song the fake answered null, kept as is.
          if (command[0] === 'get_property' && command[1] === 'idle-active') return stopped || null;
          if (command[0] === 'playlist-next' && position + 1 < playlist.length) {
            position++;
            musicEvents.emit('event', { event: 'end-file', reason: 'stop' });
            musicEvents.emit('event', { event: 'start-file' });
          }
          if (command[0] === 'set_property' && command[1] === 'volume' && typeof command[2] === 'number')
            musicVolume = command[2];
          if (command[0] === 'get_property' && command[1] === 'volume') return musicVolume;
          if (command[0] === 'get_property' && command[1] === 'playlist-pos') return position;
          if (command[0] === 'get_property' && command[1] === 'path') return playlist[position];
          return null;
        },
        close() {},
      },
    }).create({
      ...deps,
      fetch: async () => new Response(readFileSync(new URL('../../music-art.png', import.meta.url))),
    });
  },
});
