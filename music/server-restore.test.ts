import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from '../../apps/server/src/core/module.ts';
import { buildServer } from './test-server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { wiring } from './test-wiring.ts';

const url = (id: string) => `https://music.youtube.com/watch?v=${id}`;

/** An mpv that keeps playing across a restart of Hub: `mpv` holds what it would answer. */
function fakeMpv(mpv: Record<string, unknown>) {
  return {
    events: new EventEmitter(),
    async request(command: (string | number | boolean)[]): Promise<unknown> {
      if (command[0] === 'get_property' && typeof command[1] === 'string' && command[1] in mpv) return mpv[command[1]];
      return wiring.ipc.request(command);
    },
    close() {},
  };
}

const queueResponseSchema = z.object({
  result: z.object({
    data: z.object({
      current: z.object({ id: z.string() }).nullable(),
      upcoming: z.array(z.object({ id: z.string() })),
    }),
  }),
});

const queueOf = async (app: ReturnType<typeof buildServer>) =>
  queueResponseSchema.parse((await app.inject('/trpc/music.queue')).json()).result.data;

void test('a restart of Hub takes back the queue mpv is still playing, and drops it when mpv moved on', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-music-restore-'));
  const dbPath = join(dir, 'hub.db');
  const mpv: Record<string, unknown> = { 'idle-active': false };
  const first = buildServer({
    dbPath,
    music: { ...wiring, ipc: fakeMpv(mpv) },
    deps: { run: createFakeDesktop() },
  });
  await first.inject('/trpc/music.search?input=' + encodeURIComponent(JSON.stringify({ query: 'song' })));
  await first.inject({ method: 'POST', url: '/trpc/music.play', payload: { id: 'abcdefghijk' } });
  const before = await queueOf(first);
  assert.equal(before.current?.id, 'abcdefghijk');
  assert.ok(before.upcoming[0]);
  await first.close();

  // mpv still plays the same song, with the next one already appended.
  Object.assign(mpv, {
    path: url('abcdefghijk'),
    'playlist-pos': 0,
    'playlist-count': 2,
    'playlist/1/filename': url(before.upcoming[0].id),
  });
  const ipc = fakeMpv(mpv);
  const second = buildServer({ dbPath, music: { ...wiring, ipc }, deps: { run: createFakeDesktop() } });
  t.after(async () => {
    await second.close();
    await rm(dir, { recursive: true, force: true });
  });
  await second.ready();
  ipc.events.emit('event', { event: 'hub-connected' });
  let after = await queueOf(second);
  for (let tries = 0; tries < 50 && !after.current; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    after = await queueOf(second);
  }
  assert.equal(after.current?.id, 'abcdefghijk');
  assert.deepEqual(
    after.upcoming.map((song) => song.id),
    before.upcoming.map((song) => song.id),
  );

  // A third start while mpv plays something else entirely: the stored queue is not forced on it.
  await second.close();
  mpv.path = url('zzzzzzzzzzz');
  const other = fakeMpv(mpv);
  const third = buildServer({ dbPath, music: { ...wiring, ipc: other }, deps: { run: createFakeDesktop() } });
  t.after(() => third.close());
  await third.ready();
  other.events.emit('event', { event: 'hub-connected' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await queueOf(third)).current, null);
});
