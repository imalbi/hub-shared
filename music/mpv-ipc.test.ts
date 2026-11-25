import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMpvIpc } from './mpv-ipc.ts';

void test('matches replies, ignores events, times out and reconnects', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'music-ipc-'));
  const path = join(dir, 'socket');
  const server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const request = JSON.parse(line);
        if (request.command[0] === 'timeout') continue;
        socket.write(JSON.stringify({ event: 'test', request_id: request.request_id }) + '\n');
        const reply =
          JSON.stringify({ request_id: request.request_id, error: 'success', data: request.command[0] }) + '\n';
        if (request.command[0] === 'one') setTimeout(() => socket.write(reply), 10);
        else socket.write(reply);
        if (request.command[0] === 'close') socket.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const ipc = createMpvIpc(path, 40);
  t.after(async () => {
    ipc.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  });
  let eventCount = 0;
  let connects = 0;
  ipc.events.on('event', (message: { event: string }) => {
    if (message.event === 'hub-connected') connects++;
    else eventCount++;
  });
  assert.deepEqual(await Promise.all([ipc.request(['one']), ipc.request(['two'])]), ['one', 'two']);
  assert.equal(eventCount, 2);
  assert.equal(connects, 1);
  await assert.rejects(ipc.request(['timeout']));
  assert.equal(await ipc.request(['close']), 'close');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(await ipc.request(['again']), 'again');
  assert.equal(connects, 2);
});
