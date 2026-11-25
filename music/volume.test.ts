import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './test-server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { createMpvIpc } from './mpv-ipc.ts';
import { calls, wiring } from './test-wiring.ts';

function app(music = wiring) {
  return buildServer({ dbPath: ':memory:', music, deps: { run: createFakeDesktop() } });
}
const setVolume = (server: ReturnType<typeof app>, payload: object) =>
  server.inject({ method: 'POST', url: '/trpc/music.setVolume', payload });

void test('setVolume sets mpv volume through the IPC and the state reports it', async (t) => {
  const server = app();
  t.after(() => server.close());
  calls.commands.length = 0;
  assert.equal((await setVolume(server, { volume: 70 })).statusCode, 200);
  assert.deepEqual(calls.commands, [['set_property', 'volume', 70]]);
  const state = await server.inject('/trpc/music.state');
  assert.equal(state.json().result.data.volume, 70);
});

void test('setVolume rejects values outside 0..100 and non-integers without touching mpv', async (t) => {
  const server = app();
  t.after(() => server.close());
  calls.commands.length = 0;
  for (const volume of [-1, 101, 50.5, 'a'])
    assert.equal((await setVolume(server, { volume })).statusCode, 400, String(volume));
  assert.deepEqual(calls.commands, []);
  for (const volume of [0, 100]) assert.equal((await setVolume(server, { volume })).statusCode, 200);
});

void test('with mpv unreachable setVolume is a 503 without the IPC text and state has no volume', async (t) => {
  const ipc = {
    ...wiring.ipc,
    async request(): Promise<never> {
      throw new Error('socket detail 99');
    },
  };
  const server = app({ ...wiring, ipc });
  t.after(() => server.close());
  const response = await setVolume(server, { volume: 40 });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.includes('socket detail'), false);
  const state = (await server.inject('/trpc/music.state')).json().result.data;
  assert.deepEqual([state.available, state.volume], [false, null]);
});

void test('the saved volume is set again whenever Hub reconnects to a restarted mpv', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'music-volume-'));
  const path = join(dir, 'socket');
  const sockets: Socket[] = [];
  const commands: unknown[][] = [];
  const mpv = createServer((socket) => {
    sockets.push(socket);
    socket.on('data', (chunk) => {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        const request: { command: unknown[]; request_id: number } = JSON.parse(line);
        commands.push(request.command);
        socket.write(JSON.stringify({ request_id: request.request_id, error: 'success', data: 100 }) + '\n');
      }
    });
  });
  await new Promise<void>((resolve) => mpv.listen(path, resolve));
  const server = app({ ...wiring, ipc: createMpvIpc(path) });
  t.after(async () => {
    await server.close();
    await new Promise<void>((resolve) => mpv.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal((await setVolume(server, { volume: 40 })).statusCode, 200);
  const volumeSets = () => commands.filter((item) => item[1] === 'volume' && item[0] === 'set_property');
  assert.deepEqual(volumeSets(), [['set_property', 'volume', 40]]);
  // mpv restarts: its socket closes and the next request opens a new connection.
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await server.inject('/trpc/music.state');
  assert.deepEqual(volumeSets(), [
    ['set_property', 'volume', 40],
    ['set_property', 'volume', 40],
  ]);
});

void test('with no saved volume a new connection leaves mpv at its default', async (t) => {
  const server = app();
  t.after(() => server.close());
  calls.commands.length = 0;
  wiring.ipc.events.emit('event', { event: 'hub-connected' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(calls.commands, []);
});
