import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './test-server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { createMpvIpc } from './mpv-ipc.ts';
import { wiring } from './test-wiring.ts';

const url = (id: string) => `https://music.youtube.com/watch?v=${id}`;
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

async function fixture(t: import('node:test').TestContext, noRadio = false, missingPath = false) {
  const dir = await mkdtemp(join(tmpdir(), 'music-playlist-'));
  const path = join(dir, 'socket');
  let client: Socket | undefined;
  let playlist: string[] = [];
  let position = -1;
  let paused = false;
  const commands: (string | number | boolean)[][] = [];
  function event(value: object) {
    client?.write(JSON.stringify(value) + '\n');
  }
  function next(reason: string) {
    event({ event: 'end-file', reason });
    if (position + 1 < playlist.length) {
      position++;
      event({ event: 'start-file' });
    }
  }
  const server = createServer((socket) => {
    client = socket;
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const request: { command: (string | number | boolean)[]; request_id: number } = JSON.parse(line);
        const command = request.command;
        commands.push(command);
        let data: unknown = null;
        if (command[0] === 'loadfile' && typeof command[1] === 'string') {
          if (command[2] === 'replace') {
            playlist = [command[1]];
            position = 0;
            event({ event: 'start-file' });
          } else playlist.push(command[1]);
        } else if (command[0] === 'playlist-next') next('stop');
        else if (command[0] === 'stop') position = -1;
        else if (command[0] === 'playlist-clear') playlist = position < 0 ? [] : playlist.slice(position, position + 1);
        else if (command[0] === 'set_property' && command[1] === 'pause') paused = command[2] === true;
        else if (command[0] === 'get_property') {
          if (command[1] === 'idle-active') data = position < 0;
          if (command[1] === 'playlist-pos') data = position;
          if (command[1] === 'path') data = missingPath ? null : playlist[position];
          if (command[1] === `playlist/${position}/filename`) data = playlist[position];
        }
        socket.write(JSON.stringify({ request_id: request.request_id, error: 'success', data }) + '\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const ipc = createMpvIpc(path);
  const seeds: string[] = [];
  const youtube = {
    ...wiring.youtube,
    async upNext(seed: string) {
      seeds.push(seed);
      return noRadio ? [] : wiring.youtube.upNext();
    },
  };
  const app = buildServer({ dbPath: ':memory:', music: { youtube, ipc }, deps: { run: createFakeDesktop() } });
  t.after(async () => {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  await app.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  await tick();
  return {
    app,
    commands,
    next,
    tick,
    seeds,
    pause() {
      paused = true;
    },
    get paused() {
      return paused;
    },
    get playlist() {
      return playlist;
    },
    get position() {
      return position;
    },
  };
}

for (const [name, reason] of [
  ['natural end', 'eof'],
  ['external playlist-next', 'stop'],
]) {
  void test(`${name} follows mpv and appends one following song`, async (t) => {
    const f = await fixture(t);
    f.next(reason);
    await f.tick();
    const queue = (await f.app.inject('/trpc/music.queue')).json().result.data;
    assert.equal(queue.current.id, '00000000001');
    assert.deepEqual(f.playlist.slice(f.position), [url('00000000001'), url('00000000002')]);
  });
}

for (const paused of [false, true]) {
  void test(`skip follows the playlist${paused ? ' from pause' : ''}`, async (t) => {
    const f = await fixture(t);
    if (paused) f.pause();
    assert.equal((await f.app.inject({ method: 'POST', url: '/trpc/music.skip', payload: {} })).statusCode, 200);
    await f.tick();
    assert.ok(f.commands.some((command) => command[0] === 'playlist-next'));
    assert.equal((await f.app.inject('/trpc/music.queue')).json().result.data.current.id, '00000000001');
    assert.equal(f.paused, false);
  });
}

void test('three consecutive errors stop the radio', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.playlist.slice(f.position), [url('abcdefghijk'), url('00000000001')]);
  for (let i = 0; i < 3; i++) {
    f.next('error');
    await f.tick();
  }
  const queue = (await f.app.inject('/trpc/music.queue')).json().result.data;
  assert.equal(queue.errors, 3);
  assert.equal(queue.current, null);
  assert.deepEqual(f.playlist, []);
});

void test('each next song is loaded once across an end and start event', async (t) => {
  const f = await fixture(t);
  f.next('eof');
  await f.tick();
  assert.deepEqual(
    f.commands.filter((command) => command[0] === 'loadfile'),
    [
      ['loadfile', url('abcdefghijk'), 'replace'],
      ['loadfile', url('00000000001'), 'append'],
      ['loadfile', url('00000000002'), 'append'],
    ],
  );
});

void test('radio refills from the last queued song below three upcoming tracks', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.seeds, ['abcdefghijk']);
  f.next('eof');
  await f.tick();
  assert.deepEqual(f.seeds, ['abcdefghijk', '00000000003']);
});

void test('an exhausted playlist clears the current queue entry', async (t) => {
  const f = await fixture(t, true);
  f.next('eof');
  await f.tick();
  assert.equal((await f.app.inject('/trpc/music.queue')).json().result.data.current, null);
});

void test('start-file follows the playlist when path is not populated yet', async (t) => {
  const f = await fixture(t, false, true);
  f.next('eof');
  await f.tick();
  assert.equal((await f.app.inject('/trpc/music.queue')).json().result.data.current.id, '00000000001');
});

void test('the same song twice in a row plays twice and the queue stays on the first', async (t) => {
  // Regression (23f review): the start-file of the song just loaded matched the next song by URL, so the queue
  // advanced while mpv was still on the first copy.
  const f = await fixture(t);
  const mutate = (path: string, payload: object) =>
    f.app.inject({
      method: 'POST',
      url: `/trpc/music.${path}`,
      payload,
      headers: { 'content-type': 'application/json' },
    });
  const playlistId = (await mutate('createPlaylist', { name: 'Twice' })).json().result.data.id;
  for (const [id, title] of [
    ['bbbbbbbbbbb', 'Again'],
    ['bbbbbbbbbbb', 'Again'],
    ['ccccccccccc', 'After'],
  ])
    await mutate('addToPlaylist', { playlistId, id, title, artist: 'Artista' });
  assert.equal((await mutate('playPlaylist', { id: playlistId })).statusCode, 200);
  await f.tick();
  let queue = (await f.app.inject('/trpc/music.queue')).json().result.data;
  assert.equal(queue.current.id, 'bbbbbbbbbbb');
  assert.equal(queue.upcoming[0].id, 'bbbbbbbbbbb');
  assert.deepEqual(f.playlist, [url('bbbbbbbbbbb'), url('bbbbbbbbbbb')]);
  f.next('eof');
  await f.tick();
  queue = (await f.app.inject('/trpc/music.queue')).json().result.data;
  assert.equal(queue.current.id, 'bbbbbbbbbbb');
  assert.equal(queue.upcoming[0].id, 'ccccccccccc');
  assert.equal(f.position, 1);
});
