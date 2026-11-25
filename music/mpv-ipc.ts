import { createConnection, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';

export function createMpvIpc(path: string, timeout = 3000) {
  let socket: Socket | undefined;
  let connecting: Promise<Socket> | undefined;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const events = new EventEmitter();
  function disconnect() {
    socket = undefined;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('mpv disconnected'));
    }
    pending.clear();
  }
  function connect(): Promise<Socket> {
    if (socket && !socket.destroyed) return Promise.resolve(socket);
    if (connecting) return connecting;
    connecting = new Promise<Socket>((resolve, reject) => {
      const client = createConnection(path);
      let buffer = '';
      client.once('connect', () => {
        socket = client;
        // Synchronous, so a listener's own request is written before the one that waited for this connection.
        events.emit('event', { event: 'hub-connected' });
        resolve(client);
      });
      client.once('error', reject);
      client.on('close', disconnect);
      client.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          let message: unknown;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (!message || typeof message !== 'object') continue;
          if ('event' in message) {
            events.emit('event', message);
            continue;
          }
          if (!('request_id' in message) || typeof message.request_id !== 'number') continue;
          const item = pending.get(message.request_id);
          if (!item) continue;
          pending.delete(message.request_id);
          clearTimeout(item.timer);
          if ('error' in message && message.error === 'success')
            item.resolve('data' in message ? message.data : undefined);
          else item.reject(new Error('mpv command failed'));
        }
      });
    }).finally(() => {
      connecting = undefined;
    });
    return connecting;
  }
  return {
    events,
    async request(command: (string | number | boolean)[]) {
      const client = await connect();
      const id = ++nextId;
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('mpv timeout'));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        client.write(JSON.stringify({ command, request_id: id }) + '\n');
      });
    },
    close() {
      socket?.destroy();
    },
  };
}
