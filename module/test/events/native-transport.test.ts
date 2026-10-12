/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { LinkClient } from '../../src/link/client.js';
import { installEventTap } from '../../src/events/index.js';
import { task27DropSocket, task27OwnedSocket } from './native-plan.js';

it('drops only the owned GM transport and rewelcomes the actual client with sequence one and no pending replay', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Local fixture port unavailable');
  const url = `ws://127.0.0.1:${address.port}`;
  const sockets = new Set<WebSocket>(),
    events: any[] = [],
    callbacks = new Map<string, any>();
  let welcomes = 0;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello')
        socket.send(
          JSON.stringify({
            type: 'welcome',
            protocolVersion: PROTOCOL_VERSION,
            gatewayVersion: '0.1.0',
            connectionId: `c${++welcomes}`,
            agentId: 'a',
          }),
        );
      if (msg.type === 'event') events.push(msg.event);
    });
  });
  const client = new LinkClient({
    getGatewayUrl: () => url,
    getToken: () => ({ url, token: 'local-test' }),
    setToken: () => {},
    random: () => 0,
    notifyError: () => {},
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.369',
      world: { id: 'w', title: 'w', system: 'test', systemVersion: '1' },
      user: { id: 'u', name: 'GM', role: 4, isGM: true },
    }),
    createSocket: (u) => new WebSocket(u) as any,
  });
  const user = { id: 'u', isGM: true };
  const tap = installEventTap(client, {
    hooks: {
      on: (name, fn) => {
        callbacks.set(name, fn);
        return name;
      },
      off: () => {},
    },
    user: () => user,
    canvas: () => null,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
  const wait = async (predicate: () => boolean) => {
    for (let n = 0; !predicate(); n++) {
      if (n === 300) throw Error('Local reconnect deadline');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const actor = {
    id: 'x',
    uuid: 'Actor.x',
    documentName: 'Actor',
    name: 'before',
    testUserPermission: () => true,
  };
  try {
    client.start();
    await wait(() => welcomes === 1 && client.state.kind === 'connected');
    const socket = task27OwnedSocket({ sockets });
    const principal = { id: 'c1', closed: false };
    callbacks.get('createActor')(actor, {});
    await wait(() => events.length === 1);
    expect(events[0].seq).toBe(1);
    callbacks.get('updateActor')(actor, { name: 'pending' }, {});
    expect(() => task27DropSocket({ sockets }, socket, principal, { ...principal })).toThrow(
      'custody',
    );
    expect(socket.readyState).toBe(WebSocket.OPEN);
    task27DropSocket({ sockets }, socket, principal, principal);
    await wait(() => welcomes === 2 && client.state.kind === 'connected');
    callbacks.get('createActor')(actor, {});
    await wait(() => events.length === 2);
    expect(events.map((e) => [e.seq, e.type])).toEqual([
      [1, 'actor_create'],
      [1, 'actor_create'],
    ]);
    await new Promise((r) => setTimeout(r, 550));
    expect(events).toHaveLength(2);
  } finally {
    tap.dispose();
    client.stop();
    for (const socket of sockets) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);
