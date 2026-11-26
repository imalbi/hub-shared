import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { buildServer } from './test-server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { calls, wiring } from './test-wiring.ts';

void test('public playlist rejects invalid ids before YouTube is called', async (t) => {
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const response = await app.inject(
    '/trpc/music.publicPlaylist?input=' + encodeURIComponent(JSON.stringify({ id: '../bad' })),
  );
  assert.equal(response.statusCode, 400);
});

void test('public playlist play and save answer 503 without the YouTube error text', async (t) => {
  const youtube = {
    ...wiring.youtube,
    async playlist(): Promise<never> {
      throw new Error('upstream detail 1234');
    },
  };
  const app = buildServer({ dbPath: ':memory:', music: { ...wiring, youtube }, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  for (const path of ['playPublicPlaylist', 'savePublicPlaylist']) {
    const response = await app.inject({
      method: 'POST',
      url: `/trpc/music.${path}`,
      payload: { id: 'PLabc' },
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(response.statusCode, 503, path);
    assert.equal(response.body.includes('upstream detail'), false, path);
  }
});

void test('playlists keep dense positions when songs are reordered and removed', async (t) => {
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const mutate = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/music.${name}`, payload });
  const created = await mutate('createPlaylist', { name: 'Mix' });
  assert.equal(created.statusCode, 200);
  const playlistId = created.json().result.data.id;
  for (const [id, title] of [
    ['abcdefghijk', 'First'],
    ['00000000001', 'Second'],
    ['00000000002', 'Third'],
  ]) {
    assert.equal((await mutate('addToPlaylist', { playlistId, id, title, artist: 'Artist' })).statusCode, 200);
  }
  const initial = (
    await app.inject('/trpc/music.playlist?input=' + encodeURIComponent(JSON.stringify({ id: playlistId })))
  ).json().result.data.songs;
  const [first, second, third] = initial;
  assert.equal(
    (await mutate('movePlaylistSong', { playlistId, itemId: third.itemId, toItemId: first.itemId })).statusCode,
    200,
  );
  assert.equal((await mutate('removePlaylistSong', { playlistId, itemId: first.itemId })).statusCode, 200);
  // A stale browser action must never remove the row now occupying the old position.
  assert.equal((await mutate('removePlaylistSong', { playlistId, itemId: first.itemId })).statusCode, 404);
  assert.equal(
    (await mutate('movePlaylistSong', { playlistId, itemId: second.itemId, toItemId: first.itemId })).statusCode,
    404,
  );
  const list = await app.inject('/trpc/music.playlist?input=' + encodeURIComponent(JSON.stringify({ id: playlistId })));
  assert.deepEqual(
    list.json().result.data.songs.map(({ id, position }: { id: string; position: number }) => [id, position]),
    [
      ['00000000002', 0],
      ['00000000001', 1],
    ],
  );
});

void test('artist rejects invalid channel ids before accessing YouTube', async (t) => {
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const response = await app.inject('/trpc/music.artist?input=' + encodeURIComponent(JSON.stringify({ id: 'bad' })));
  assert.equal(response.statusCode, 400);
});

void test('artist proxies its banner and album art and keeps top songs for playback', async (t) => {
  calls.commands.length = 0;
  const app = buildServer({
    dbPath: ':memory:',
    music: wiring,
    deps: {
      run: createFakeDesktop(),
      fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')),
    },
  });
  t.after(() => app.close());
  const response = await app.inject(
    '/trpc/music.artist?input=' + encodeURIComponent(JSON.stringify({ id: 'UCabcdefghijklmnopqrstuv' })),
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes('ytimg.com'), false);
  assert.equal(response.json().result.data.banner, 'data:image/webp;base64,UklGRgQAAABXRUJQ');
  assert.equal(response.json().result.data.albums[0].cover, 'data:image/webp;base64,UklGRgQAAABXRUJQ');
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  assert.equal((await app.inject('/trpc/music.queue')).json().result.data.current.title, 'Artist song');
});

void test('search and play validate and conceal remote artwork', async (t) => {
  calls.queries.length = 0;
  calls.commands.length = 0;
  const imageCommands: string[][] = [];
  const fakeDesktop = createFakeDesktop();
  const app = buildServer({
    dbPath: ':memory:',
    music: wiring,
    deps: {
      run: (bin, args, options) => {
        if (bin === 'magick') imageCommands.push(args);
        return fakeDesktop(bin, args, options);
      },
      fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')),
    },
  });
  t.after(() => app.close());
  calls.commands.push(['loadfile']);
  const resumed = await app.inject('/trpc/music.state');
  assert.equal(resumed.json().result.data.playing.id, 'abcdefghijk');
  assert.equal(resumed.json().result.data.playing.title, 'Song');
  calls.commands.length = 0;
  const search = await app.inject(
    '/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: '  a song  ' })),
  );
  assert.equal(search.statusCode, 200);
  assert.deepEqual(calls.queries, ['  a song  ']);
  assert.equal(search.body.includes('i.ytimg.com'), false);
  assert.equal(search.json().result.data[0].cover, 'data:image/webp;base64,UklGRgQAAABXRUJQ');
  assert.deepEqual(imageCommands, []);
  const play = (id: string) =>
    app.inject({
      method: 'POST',
      url: '/trpc/music.play',
      headers: { 'content-type': 'application/json' },
      payload: { id },
    });
  assert.equal((await play('bad')).statusCode, 400);
  assert.deepEqual(calls.commands, []);
  assert.equal((await play('abcdefghijk')).statusCode, 200);
  assert.deepEqual(
    calls.commands.filter((command) => command[0] === 'loadfile'),
    [
      ['loadfile', 'https://music.youtube.com/watch?v=abcdefghijk', 'replace'],
      ['loadfile', 'https://music.youtube.com/watch?v=00000000001', 'append'],
    ],
  );
  // A paused mpv keeps its pause across loadfile, so play must also resume.
  assert.ok(
    calls.commands.some((command) => command[0] === 'set_property' && command[1] === 'pause' && command[2] === false),
  );
  const state = await app.inject('/trpc/music.state');
  assert.equal(state.json().result.data.available, true);
  assert.equal(state.json().result.data.playing.id, 'abcdefghijk');
});

void test('favorites toggle twice and retain metadata without the network', async (t) => {
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const song = { id: 'abcdefghijk', title: 'Song', artist: 'Artist' };
  const toggle = () => app.inject({ method: 'POST', url: '/trpc/music.toggleFavorite', payload: song });
  assert.equal((await toggle()).statusCode, 200);
  const first = await app.inject('/trpc/music.favorites');
  assert.deepEqual(
    first.json().result.data.map(({ id, title, artist }: typeof song) => ({ id, title, artist })),
    [song],
  );
  assert.equal((await toggle()).statusCode, 200);
  assert.deepEqual((await app.inject('/trpc/music.favorites')).json().result.data, []);
});

void test('history records only after 30 seconds of playback, excluding paused time', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let playback = 0;
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return playback;
      return wiring.ipc.request(command);
    },
  };
  const app = buildServer({ dbPath: ':memory:', music: { ...wiring, ipc }, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  const history = async () => (await app.inject('/trpc/music.history')).json().result.data;
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(await history(), []);
  playback = 30;
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await history()).length, 1);
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal((await history()).length, 1);
});

void test('recent lists each song once, newest first, with its cover through the proxy', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const fetched: string[] = [];
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { ...wiring, ipc },
    deps: {
      run: createFakeDesktop(),
      fetch: async (url) => {
        fetched.push(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url);
        return new Response(Buffer.from('524946460400000057454250', 'hex'));
      },
    },
  });
  t.after(() => app.close());
  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  for (let listen = 0; listen < 2; listen++) {
    await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
    t.mock.timers.tick(30000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal((await app.inject('/trpc/music.history')).json().result.data.length, 2);
  const recent = (await app.inject('/trpc/music.recent')).json().result.data;
  assert.deepEqual(recent, [
    { id: 'abcdefghijk', title: 'Song', artist: 'Artist', cover: 'data:image/webp;base64,UklGRgQAAABXRUJQ' },
  ]);
  assert.ok(fetched.includes('https://i.ytimg.com/cover'));
});

void test('history returns the latest 200 plays, newest first', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const app = buildServer({ dbPath: ':memory:', music: { ...wiring, ipc }, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  for (let listen = 0; listen < 205; listen++) {
    await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
    t.mock.timers.tick(30000);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const rows: { playedAt: number }[] = (await app.inject('/trpc/music.history')).json().result.data;
  assert.equal(rows.length, 200);
  assert.deepEqual(
    rows.map((row) => row.playedAt),
    rows.map((row) => row.playedAt).toSorted((a, b) => b - a),
  );
});

void test('a recent song with no stored cover asks YouTube for its artwork once and keeps it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  calls.covers.length = 0;
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const youtube = {
    ...wiring.youtube,
    async search() {
      return { songs: [{ id: 'abcdefghijk', title: 'Song', artists: [{ name: 'Artist' }] }], dropped: 0 };
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { youtube, ipc },
    deps: { run: createFakeDesktop(), fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')) },
  });
  t.after(() => app.close());
  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const first = (await app.inject('/trpc/music.recent')).json().result.data;
  assert.equal(first[0].cover, 'data:image/webp;base64,UklGRgQAAABXRUJQ');
  await app.inject('/trpc/music.recent');
  assert.deepEqual(calls.covers, ['abcdefghijk']);
});

void test('skipping before 30 seconds leaves the song out of history', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const app = buildServer({ dbPath: ':memory:', music: { ...wiring, ipc }, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  t.mock.timers.tick(29000);
  await app.inject({ method: 'POST', url: '/trpc/music.skip', payload: {} });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual((await app.inject('/trpc/music.history')).json().result.data, []);
});

void test('the playlist list reports each count and up to four covers from the first songs', async (t) => {
  const app = buildServer({
    dbPath: ':memory:',
    music: wiring,
    deps: {
      run: createFakeDesktop(),
      fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')),
    },
  });
  t.after(() => app.close());
  const mutate = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/music.${name}`, payload });
  const empty = (await mutate('createPlaylist', { name: 'Vuota' })).json().result.data.id;
  const full = (await mutate('createPlaylist', { name: 'Piena' })).json().result.data.id;
  for (let i = 0; i < 6; i++)
    await mutate('addToPlaylist', { playlistId: full, id: String(i).padStart(11, '0'), title: `S${i}`, artist: '' });
  const rows: { id: number; count: number; covers: string[] }[] = (await app.inject('/trpc/music.playlists')).json()
    .result.data;
  const own = (id: number) => rows.find((row) => row.id === id);
  assert.deepEqual([own(empty)?.count, own(empty)?.covers], [0, []]);
  assert.equal(own(full)?.count, 6);
  assert.equal(own(full)?.covers.length, 4);
  assert.match(own(full)?.covers[0] ?? '', /^data:image\/webp;base64,/);
  // The open playlist gives every row its own cover through the proxy, never the remote URL.
  const opened = await app.inject('/trpc/music.playlist?input=' + encodeURIComponent(JSON.stringify({ id: full })));
  const songs: { cover: string | null }[] = opened.json().result.data.songs;
  assert.equal(songs.length, 6);
  assert.ok(songs.every((song) => song.cover?.startsWith('data:image/webp;base64,')));
  assert.equal(opened.body.includes('ytimg.com'), false);
});

void test('the queue names the song a radio started from, and no seed after a playlist', async (t) => {
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const mutate = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/music.${name}`, payload });
  const seed = async () => (await app.inject('/trpc/music.queue')).json().result.data.seed;
  assert.equal(await seed(), null);
  await mutate('play', { id: 'abcdefghijk' });
  assert.equal((await seed()).id, 'abcdefghijk');
  await mutate('playPublicPlaylist', { id: 'PLexample' });
  // The fake list has one song, so radio follows it: the seed is that song.
  assert.equal((await seed()).id, 'abcdefghijk');
});

void test('stop halts mpv, empties the queue and adds nothing to history', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const app = buildServer({ dbPath: ':memory:', music: wiring, deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  const before = calls.commands.length;
  const res = await app.inject({ method: 'POST', url: '/trpc/music.stop', payload: {} });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    calls.commands.slice(before).map((command) => command[0]),
    ['stop', 'playlist-clear'],
  );
  const queue = (await app.inject('/trpc/music.queue')).json().result.data;
  assert.equal(queue.current, null);
  assert.deepEqual(queue.upcoming, []);
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual((await app.inject('/trpc/music.history')).json().result.data, []);
});

void test('suggestions returns empty when history is empty and enforces auth', async (t) => {
  let searchCalls = 0;
  let relatedCalls = 0;
  const youtube = {
    ...wiring.youtube,
    async searchArtists() {
      searchCalls++;
      return wiring.youtube.searchArtists();
    },
    async relatedArtists() {
      relatedCalls++;
      return wiring.youtube.relatedArtists();
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { ...wiring, youtube },
    deps: { run: createFakeDesktop() },
    isLoopback: () => false,
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/trpc/music.suggestions')).statusCode, 401);

  const loopbackApp = buildServer({
    dbPath: ':memory:',
    music: { ...wiring, youtube },
    deps: { run: createFakeDesktop() },
  });
  t.after(() => loopbackApp.close());
  await loopbackApp.inject({
    method: 'POST',
    url: '/trpc/music.toggleFavorite',
    payload: { id: 'FAV00000001', title: 'Fav', artist: 'Artist' },
  });
  const response = await loopbackApp.inject('/trpc/music.suggestions');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().result.data, { again: [], radios: [], similar: null });
  assert.equal(searchCalls, 0);
  assert.equal(relatedCalls, 0);
});

void test('M5: suggestions returns similar null on failing getArtist, search failure, or non-matching artist', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 10, 20, 12, 0, 0) });
  let mode: 'throw-related' | 'throw-search' | 'no-match' = 'throw-related';
  let searchCalls = 0;
  let relatedCalls = 0;
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const youtube = {
    ...wiring.youtube,
    async searchArtists() {
      searchCalls++;
      if (mode === 'throw-search') throw new Error('search failed');
      if (mode === 'no-match') return [{ id: 'UC0000000000000000000099', name: 'Different Artist' }];
      return [{ id: 'UCabcdefghijklmnopqrstuv', name: 'Artist' }];
    },
    async relatedArtists() {
      relatedCalls++;
      throw new Error('getArtist failed');
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { youtube, ipc },
    deps: { run: createFakeDesktop(), fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')) },
  });
  t.after(() => app.close());

  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await app.inject({
    method: 'POST',
    url: '/trpc/music.toggleFavorite',
    payload: { id: 'FAV00000001', title: 'Fav Song', artist: 'Other Artist' },
  });

  const modes: Array<'throw-related' | 'throw-search' | 'no-match'> = ['throw-related', 'throw-search', 'no-match'];
  for (const nextMode of modes) {
    mode = nextMode;
    searchCalls = 0;
    relatedCalls = 0;
    const response = await app.inject('/trpc/music.suggestions');
    assert.equal(response.statusCode, 200, nextMode);
    const data = response.json().result.data;
    assert.equal(data.similar, null, nextMode);
    assert.equal(data.again.length, 1, nextMode);
    assert.equal(data.radios.length, 1, nextMode);
    assert.equal(data.radios[0].artist, 'Artist', nextMode);
    assert.equal(searchCalls, 1, nextMode);
    if (nextMode !== 'throw-related') assert.equal(relatedCalls, 0, nextMode);
  }
});

void test('M6: suggestions caches related artists for 6 hours, caps at 6 and proxies covers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 10, 20, 12, 0, 0) });
  let searchCalls = 0;
  let relatedCalls = 0;
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const youtube = {
    ...wiring.youtube,
    async searchArtists() {
      searchCalls++;
      return [{ id: 'UCabcdefghijklmnopqrstuv', name: 'Artist' }];
    },
    async relatedArtists() {
      relatedCalls++;
      return Array.from({ length: 8 }, (_, index) => ({
        id: `UC000000000000000000000${index}`,
        name: `Similar ${index}`,
        cover: `https://lh3.googleusercontent.com/similar-${index}`,
      }));
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { youtube, ipc },
    deps: {
      run: createFakeDesktop(),
      fetch: async () => new Response(Buffer.from('524946460400000057454250', 'hex')),
    },
  });
  t.after(() => app.close());

  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  await app.inject({
    method: 'POST',
    url: '/trpc/music.toggleFavorite',
    payload: { id: 'FAV00000001', title: 'Fav Song', artist: 'Other Artist' },
  });

  const first = await app.inject('/trpc/music.suggestions');
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.includes('googleusercontent.com'), false);
  assert.equal(first.body.includes('ytimg.com'), false);
  const firstData = first.json().result.data;
  assert.equal(firstData.similar.of, 'Artist');
  assert.equal(firstData.similar.artists.length, 6);
  const artists: { cover: string | null }[] = firstData.similar.artists;
  for (const artist of artists) {
    assert.match(artist.cover ?? '', /^data:image\/webp;base64,/);
  }
  assert.equal(searchCalls, 1);
  assert.equal(relatedCalls, 1);

  t.mock.timers.tick(5 * 60 * 60 * 1000);
  const second = await app.inject('/trpc/music.suggestions');
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().result.data.similar, firstData.similar);
  assert.equal(searchCalls, 1);
  assert.equal(relatedCalls, 1);

  t.mock.timers.tick(2 * 60 * 60 * 1000);
  const third = await app.inject('/trpc/music.suggestions');
  assert.equal(third.statusCode, 200);
  assert.equal(searchCalls, 2);
  assert.equal(relatedCalls, 2);
});

void test('GET /m/music/cover/:id enforces auth/origin, caches binary covers, falls back and returns 404 when off', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.UTC(2026, 10, 20, 12, 0, 0) });
  const webpBytes = Buffer.from('524946460400000057454250', 'hex');
  const fetched: string[] = [];
  const ipc = {
    ...wiring.ipc,
    async request(command: (string | number | boolean)[]) {
      if (command[1] === 'playback-time') return 30;
      return wiring.ipc.request(command);
    },
  };
  const youtube = {
    ...wiring.youtube,
    async search(query: string) {
      if (query === 'stored404') {
        return {
          songs: [
            {
              id: 'stored40401',
              title: 'Stored 404',
              artists: [{ name: 'Artist' }],
              cover: 'https://lh3.googleusercontent.com/missing-stored=w60-h60-l90-rj',
            },
          ],
          dropped: 0,
        };
      }
      return {
        songs: [
          {
            id: 'abcdefghijk',
            title: 'Song',
            artists: [{ name: 'Artist' }],
            cover: 'https://lh3.googleusercontent.com/art=w60-h60-l90-rj',
          },
        ],
        dropped: 0,
      };
    },
  };
  const app = buildServer({
    dbPath: ':memory:',
    music: { youtube, ipc },
    deps: {
      run: createFakeDesktop(),
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        fetched.push(url);
        if (url.includes('missing-stored') || url.includes('missing0001')) return new Response(null, { status: 404 });
        return new Response(webpBytes);
      },
    },
  });
  t.after(() => app.close());

  assert.equal(
    (await app.inject({ url: '/m/music/cover/abcdefghijk', headers: { host: 'evil.example' } })).statusCode,
    421,
  );
  assert.equal((await app.inject('/m/music/cover/bad')).statusCode, 400);
  assert.equal((await app.inject({ url: '/m/music/cover/abcdefghijk', remoteAddress: '192.0.2.2' })).statusCode, 401);
  assert.equal(
    (await app.inject({ url: '/m/music/cover/abcdefghijk', headers: { origin: 'https://evil.example' } })).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/m/music/cover/abcdefghijk', headers: { 'sec-fetch-site': 'cross-site' } })).statusCode,
    403,
  );

  // Record two tracks in history: one with working stored cover, one with 404 stored cover.
  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));

  await app.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'stored404' })));
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'stored40401' } });
  t.mock.timers.tick(30000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  fetched.length = 0;

  const hit = await app.inject('/m/music/cover/abcdefghijk');
  assert.equal(hit.statusCode, 200);
  assert.match(hit.headers['content-type'] ?? '', /^image\/webp/);
  assert.equal(hit.headers['x-content-type-options'], 'nosniff');
  assert.equal(hit.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(hit.headers['cache-control'], 'private, max-age=86400');
  assert.deepEqual(hit.rawPayload, webpBytes);
  assert.deepEqual(fetched, ['https://lh3.googleusercontent.com/art=w226-h226-l90-rj']);

  // Cached on second request.
  const cached = await app.inject('/m/music/cover/abcdefghijk');
  assert.equal(cached.statusCode, 200);
  assert.deepEqual(cached.rawPayload, webpBytes);
  assert.equal(fetched.length, 1);

  // Track with no history falls back to mqdefault.jpg.
  const noHistory = await app.inject('/m/music/cover/nohist00001');
  assert.equal(noHistory.statusCode, 200);
  assert.equal(fetched.at(-1), 'https://i.ytimg.com/vi/nohist00001/mqdefault.jpg');

  // Track whose stored history cover returns 404 falls back to mqdefault.jpg.
  const storedFallback = await app.inject('/m/music/cover/stored40401');
  assert.equal(storedFallback.statusCode, 200);
  assert.deepEqual(fetched.slice(-2), [
    'https://lh3.googleusercontent.com/missing-stored=w226-h226-l90-rj',
    'https://i.ytimg.com/vi/stored40401/mqdefault.jpg',
  ]);

  // Unavailable upstream cover returns 404 without long-lived cache.
  const unavailable = await app.inject('/m/music/cover/missing0001');
  assert.equal(unavailable.statusCode, 404);
  assert.equal(unavailable.headers['cache-control'], 'no-store');

  // Disabled music module returns 404.
  const offApp = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modulesOff: ['music'] },
  });
  t.after(() => offApp.close());
  assert.equal((await offApp.inject('/m/music/cover/abcdefghijk')).statusCode, 404);
});

void test('catalog actions retain their registry metadata and input schemas', async (t) => {
  const app = buildServer({ dbPath: ':memory:', deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const response = await app.inject('/trpc/registry.list');
  assert.equal(response.statusCode, 200);
  const actions: {
    path: string;
    kind: string;
    label: string;
    description: string;
    danger: boolean;
    schema: unknown;
  }[] = response.json().result.data;
  const own = actions.filter((action) => action.path.startsWith('music.'));
  assert.deepEqual(own.map((action) => action.path).toSorted(), [
    'music.addToPlaylist',
    'music.createPlaylist',
    'music.deletePlaylist',
    'music.movePlaylistSong',
    'music.play',
    'music.playPlaylist',
    'music.playPublicPlaylist',
    'music.removePlaylistSong',
    'music.renamePlaylist',
    'music.savePublicPlaylist',
    'music.setVolume',
    'music.skip',
    'music.stop',
    'music.toggleFavorite',
  ]);
  for (const action of own) {
    assert.equal(action.kind, 'mutation');
    assert.ok(action.label.trim(), action.path);
    assert.ok(action.description.trim(), action.path);
    assert.equal(typeof action.danger, 'boolean', action.path);
    assert.ok('schema' in action, action.path);
  }
});

void test('deleting a playlist requires explicit confirmation', async (t) => {
  const app = buildServer({ dbPath: ':memory:', deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const call = (input: object) => app.inject({ method: 'POST', url: '/trpc/music.deletePlaylist', payload: input });
  assert.equal((await call({ id: 999 })).statusCode, 412);
  assert.equal((await call({ id: 999, confirmed: false })).statusCode, 412);
  assert.equal((await call({ id: 999, confirmed: true })).statusCode, 404);
});

void test('a hanging radio refill cannot block stop or restore a stopped queue', async (t) => {
  let release: ((songs: Awaited<ReturnType<typeof wiring.youtube.upNext>>) => void) | undefined;
  const waiting = new Promise<Awaited<ReturnType<typeof wiring.youtube.upNext>>>((resolve) => {
    release = resolve;
  });
  const app = buildServer({
    dbPath: ':memory:',
    music: {
      ...wiring,
      youtube: { ...wiring.youtube, upNext: () => waiting },
    },
    deps: { run: createFakeDesktop() },
  });
  t.after(() => app.close());
  const play = app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const stopped = await Promise.race([
    app.inject({ method: 'POST', url: '/trpc/music.stop', payload: {} }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 200)),
  ]);
  release?.(await wiring.youtube.upNext());
  await play;
  assert.ok(stopped, 'stop must not wait for YouTube');
  assert.equal(stopped.statusCode, 200);
  assert.equal((await app.inject('/trpc/music.queue')).json().result.data.current, null);
});
