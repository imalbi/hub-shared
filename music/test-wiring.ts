import { EventEmitter } from 'node:events';
import type { Song } from './youtube.ts';
export const calls: { queries: string[]; commands: (string | number | boolean)[][]; covers: string[] } = {
  queries: [],
  commands: [],
  covers: [],
};
let volume = 100;
export const wiring = {
  youtube: {
    async searchPlaylists() {
      return [{ id: 'PLexample', title: 'Playlist' }];
    },
    async playlist() {
      return { title: 'Playlist', songs: [{ id: 'abcdefghijk', title: 'Song', artists: [{ name: 'Artist' }] }] };
    },
    async artist() {
      return {
        name: 'Artist',
        banner: 'https://i.ytimg.com/banner',
        songs: [{ id: 'abcdefghijk', title: 'Artist song', artists: [{ name: 'Artist' }] }],
        albums: [{ title: 'Album', cover: 'https://i.ytimg.com/album' }],
      };
    },
    async searchArtists() {
      return [{ id: 'UCabcdefghijklmnopqrstuv', name: 'Artist' }];
    },
    async relatedArtists() {
      return [
        {
          id: 'UC0000000000000000000001',
          name: 'Similar Artist',
          cover: 'https://lh3.googleusercontent.com/similar-artist',
        },
      ];
    },
    async cover(id: string): Promise<string | undefined> {
      calls.covers.push(id);
      return 'https://i.ytimg.com/art';
    },
    async upNext() {
      return [
        { id: '00000000001', title: 'Brano 2', artists: [{ name: 'Artista' }] },
        { id: '00000000002', title: 'Brano 3', artists: [{ name: 'Artista' }] },
        { id: '00000000003', title: 'Brano 4', artists: [{ name: 'Artista' }] },
      ];
    },
    async search(query: string): Promise<{ songs: Song[]; dropped: number }> {
      calls.queries.push(query);
      return {
        songs: [
          { id: 'abcdefghijk', title: 'Song', artists: [{ name: 'Artist' }], cover: 'https://i.ytimg.com/cover' },
        ],
        dropped: 0,
      };
    },
  },
  ipc: {
    events: new EventEmitter(),
    async request(command: (string | number | boolean)[]): Promise<unknown> {
      calls.commands.push(command);
      if (command[0] === 'set_property' && command[1] === 'volume' && typeof command[2] === 'number')
        volume = command[2];
      if (command[1] === 'volume') return volume;
      if (command[1] === 'idle-active') return !calls.commands.some((item) => item[0] === 'loadfile');
      if (command[1] === 'path') return 'https://music.youtube.com/watch?v=abcdefghijk';
      if (command[1] === 'media-title') return 'Song';
      if (command[1] === 'metadata') return { artist: 'Artist' };
      return true;
    },
    close() {},
  },
};
