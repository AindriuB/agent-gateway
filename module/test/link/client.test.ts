/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  LinkClient,
  backoffDelay,
  type SocketLike,
} from '../../src/link/client.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  closed = false;
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {
    this.closed = true;
  }
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const welcome = (extra: object = {}) => ({
  type: 'welcome',
  gatewayVersion: '0.1.0',
  protocolVersion: '1.0.0',
  connectionId: 'c1',
  agentId: 'a1',
  ...extra,
});

let sockets: FakeSocket[];
let token: string;
let errors: string[];
let client: LinkClient;

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  token = '';
  errors = [];
  client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => token,
    setToken: (t) => void (token = t),
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'My World', system: 'dnd5e', systemVersion: '5' },
      user: { id: 'u', name: 'Gm', role: 4, isGM: true },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: (m) => errors.push(m),
    random: () => 0,
  });
});
afterEach(() => vi.useRealTimers());

const open = (i = sockets.length - 1) => sockets[i]!.onopen?.();

it('does not connect on start without a stored token', () => {
  client.start();
  expect(sockets).toHaveLength(0);
});

it('pairs with a code, stores the issued token, reports connected', async () => {
  client.pair('ABC-123');
  open();
  expect(sockets[0]!.sent[0]).toMatchObject({
    type: 'hello',
    protocolVersion: '1.0.0',
    auth: { kind: 'pairingCode', code: 'ABC-123' },
    user: { name: 'Gm' },
    world: { title: 'My World' },
  });
  sockets[0]!.recv(welcome({ pairingToken: 'tok' }));
  await vi.advanceTimersByTimeAsync(0);
  expect(token).toBe('tok');
  expect(client.state).toEqual({ kind: 'connected', user: 'Gm', world: 'My World' });
});

it('uses the stored token on start', () => {
  token = 'tok';
  client.start();
  open();
  expect(sockets[0]!.sent[0].auth).toEqual({ kind: 'pairingToken', token: 'tok' });
});

it('backoff is exponential, 1s..60s, with jitter', () => {
  expect(backoffDelay(0, 0)).toBe(1000);
  expect(backoffDelay(1, 0)).toBe(2000);
  expect(backoffDelay(3, 0.5)).toBe(7200);
  expect(backoffDelay(20, 0)).toBe(BACKOFF_MAX_MS);
  expect(backoffDelay(20, 1)).toBe(48_000);
  expect(backoffDelay(0, 1)).toBe(1000);
  const capped = new Set([0, 0.25, 0.5, 0.75, 1].map((r) => backoffDelay(8, r)));
  expect(capped.size).toBeGreaterThan(1);
  for (const d of capped) expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS);
});

it('reconnects with growing delay and resets after welcome', async () => {
  token = 'tok';
  client.start();
  sockets[0]!.onclose?.();
  await vi.advanceTimersByTimeAsync(999);
  expect(sockets).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(sockets).toHaveLength(2);
  sockets[1]!.onclose?.();
  await vi.advanceTimersByTimeAsync(1999);
  expect(sockets).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(sockets).toHaveLength(3);
  open();
  sockets[2]!.recv(welcome());
  await vi.advanceTimersByTimeAsync(0);
  sockets[2]!.onclose?.();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(4);
});

it('PAIRING_INVALID clears the token and stops retrying', async () => {
  token = 'stale';
  client.start();
  open();
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(token).toBe('');
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'PAIRING_INVALID' });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sockets).toHaveLength(1);
});

it('a rejected pairing code leaves an existing token intact', async () => {
  token = 'good';
  client.pair('WRONG');
  open();
  sockets[0]!.recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await vi.advanceTimersByTimeAsync(0);
  expect(token).toBe('good');
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'PAIRING_INVALID' });
});

it('PROTOCOL_MAJOR_MISMATCH stops retrying and shows the gateway message', async () => {
  token = 'tok';
  client.start();
  open();
  sockets[0]!.recv({
    type: 'reject',
    code: 'PROTOCOL_MAJOR_MISMATCH',
    message: 'Upgrade the module',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(errors).toEqual(['Upgrade the module']);
  expect(token).toBe('tok');
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sockets).toHaveLength(1);
});

const call = { type: 'call', id: 'k1', sessionId: 's', tool: 'x', args: {} };

it('replies TOOL_NOT_FOUND when no onCall handler is installed', async () => {
  token = 'tok';
  client.start();
  open();
  sockets[0]!.recv(call);
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets[0]!.sent[1]).toMatchObject({ type: 'error', id: 'k1', code: 'TOOL_NOT_FOUND' });
});

it('passes calls to onCall and sends the result', async () => {
  token = 'tok';
  client.onCall = (c) => ({ ok: true, text: `ran ${c.tool}` });
  client.start();
  open();
  sockets[0]!.recv(call);
  await vi.advanceTimersByTimeAsync(0);
  expect(sockets[0]!.sent[1]).toEqual({ type: 'result', id: 'k1', ok: true, text: 'ran x' });
});

it('stop cancels pending reconnects', async () => {
  token = 'tok';
  client.start();
  sockets[0]!.onclose?.();
  client.stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(sockets).toHaveLength(1);
});
