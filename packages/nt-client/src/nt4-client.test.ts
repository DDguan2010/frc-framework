import { once } from 'node:events';
import net from 'node:net';

import { decodeMulti, encode } from '@msgpack/msgpack';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer, type WebSocket } from 'ws';

import { Nt4Client } from './nt4-client.js';
import type { NtDiagnostic, NtStatusEvent, NtValueUpdate } from './types.js';

const servers: WebSocketServer[] = [];
const clients: Nt4Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) {
    client.disconnect();
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const socket of server.clients) {
            socket.terminate();
          }
          server.close(() => resolve());
        }),
    ),
  );
});

describe('Nt4Client', () => {
  it('connects, subscribes to a prefix, receives values, and publishes a change', async () => {
    const server = await createServer();
    const controls: unknown[] = [];
    const writes: unknown[][] = [];

    server.on('connection', (socket) => {
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          for (const decoded of decodeMulti(new Uint8Array(data as Buffer))) {
            const message = decoded as unknown[];
            if (message[0] === -1) {
              socket.send(encode([-1, Math.round(Date.now() * 1_000), 2, message[3]]));
            } else {
              writes.push(message);
            }
          }
          return;
        }

        const messages = JSON.parse(data.toString()) as unknown[];
        controls.push(...messages);
        if (JSON.stringify(messages).includes('subscribe')) {
          socket.send(
            JSON.stringify([
              {
                method: 'announce',
                params: {
                  id: 7,
                  name: '/Tuning/Shooter/kP',
                  properties: { cached: true },
                  type: 'double',
                },
              },
            ]),
          );
          socket.send(encode([7, 1000, 1, 22]));
        }
      });
    });

    const client = trackedClient();
    const valuePromise = nextEvent<NtValueUpdate>((resolve) => client.onValue(resolve));
    client.subscribe(['/Tuning/']);
    client.connect({ host: '127.0.0.1', port: serverPort(server) });

    const update = await valuePromise;
    expect(update).toEqual(
      expect.objectContaining({
        topic: expect.objectContaining({ name: '/Tuning/Shooter/kP', type: 'double' }),
        value: 22,
      }),
    );
    expect(controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'subscribe',
          params: expect.objectContaining({ topics: ['/Tuning/'] }),
        }),
      ]),
    );

    client.write('/Tuning/Shooter/kP', 'double', 24);
    await waitUntil(() => writes.some((message) => message[3] === 24));
    expect(writes.some((message) => message[2] === 1 && message[3] === 24)).toBe(true);
  });

  it('reports topic type changes and ignores mismatched value frames', async () => {
    const server = await createServer();
    let connectedSocket: WebSocket | undefined;
    server.on('connection', (socket) => {
      connectedSocket = socket;
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          const message = [...decodeMulti(new Uint8Array(data as Buffer))][0] as
            unknown[] | undefined;
          if (message?.[0] === -1) {
            socket.send(encode([-1, 1000, 2, message[3]]));
          }
        }
      });
    });

    const client = trackedClient();
    const diagnostics: NtDiagnostic[] = [];
    const values: NtValueUpdate[] = [];
    client.onDiagnostic((event) => diagnostics.push(event));
    client.onValue((event) => values.push(event));
    const connected = nextEvent<NtStatusEvent>((resolve) =>
      client.onStatus((event) => event.state === 'connected' && resolve(event)),
    );
    client.connect({ host: '127.0.0.1', port: serverPort(server) });
    await connected;
    const socket = connectedSocket;
    expect(socket).toBeDefined();

    socket?.send(
      JSON.stringify([
        {
          method: 'announce',
          params: { id: 1, name: '/Tuning/Test', properties: {}, type: 'double' },
        },
        {
          method: 'announce',
          params: { id: 1, name: '/Tuning/Test', properties: {}, type: 'string' },
        },
      ]),
    );
    socket?.send(encode([1, 2, 1, 42]));
    await waitUntil(() => diagnostics.length >= 2);

    expect(diagnostics.map((event) => event.code)).toEqual(
      expect.arrayContaining(['topic-type-changed', 'topic-type-mismatch']),
    );
    expect(values).toHaveLength(0);
  });

  it('automatically reconnects and restores subscriptions', async () => {
    const server = await createServer();
    let connections = 0;
    let subscriptions = 0;
    server.on('connection', (socket) => {
      connections += 1;
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          const message = [...decodeMulti(new Uint8Array(data as Buffer))][0] as
            unknown[] | undefined;
          if (message?.[0] === -1) {
            socket.send(encode([-1, 1000, 2, message[3]]));
          }
          return;
        }
        if (data.toString().includes('subscribe')) {
          subscriptions += 1;
          if (connections === 1) {
            socket.close();
          }
        }
      });
    });

    const client = trackedClient({ reconnectDelayMs: 20 });
    client.subscribe(['/Tuning/']);
    client.connect({ host: '127.0.0.1', port: serverPort(server) });
    await waitUntil(() => connections >= 2 && subscriptions >= 2, 3_000);

    expect(connections).toBeGreaterThanOrEqual(2);
    expect(subscriptions).toBeGreaterThanOrEqual(2);
  });

  it('surfaces connection refusal and timeout state without retry when disabled', async () => {
    const unusedPort = await findUnusedPort();
    const client = trackedClient({ autoReconnect: false, handshakeTimeoutMs: 100 });
    const statuses: NtStatusEvent[] = [];
    client.onStatus((event) => statuses.push(event));
    client.connect({ host: '127.0.0.1', port: unusedPort });
    await waitUntil(() => statuses.some((event) => event.state === 'error'));

    expect(statuses.some((event) => event.state === 'error')).toBe(true);
    await waitUntil(() => client.state === 'disconnected');
  });
});

function trackedClient(options: ConstructorParameters<typeof Nt4Client>[0] = {}): Nt4Client {
  const client = new Nt4Client({
    heartbeatIntervalMs: 50,
    heartbeatTimeoutMs: 250,
    ...options,
  });
  clients.push(client);
  return client;
}

async function createServer(): Promise<WebSocketServer> {
  const server = new WebSocketServer({
    handleProtocols: (protocols) =>
      protocols.has('v4.1.networktables.first.wpi.edu')
        ? 'v4.1.networktables.first.wpi.edu'
        : false,
    host: '127.0.0.1',
    port: 0,
  });
  servers.push(server);
  await once(server, 'listening');
  return server;
}

function serverPort(server: WebSocketServer): number {
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP address for the NT4 test server.');
  }
  return address.port;
}

function nextEvent<T>(subscribe: (resolve: (value: T) => void) => () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for NT4 event.')), 2_000);
    const unsubscribe = subscribe((value) => {
      clearTimeout(timeout);
      unsubscribe();
      resolve(value);
    });
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 10,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for NT4 test condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function findUnusedPort(): Promise<number> {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected a TCP address.');
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error === undefined ? resolve() : reject(error))),
  );
  return port;
}
