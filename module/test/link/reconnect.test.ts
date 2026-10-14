/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { beforeEach, expect, it } from 'vitest';
import { LinkClient, backoffDelay, type SocketLike } from '../../src/link/client.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

interface Timer {
  fn: () => void;
  ms: number;
  live: boolean;
}

let sockets: FakeSocket[];
let timers: Timer[];
let token: string;
let tokenUrl: string;
let gwUrl: string;
let client: LinkClient;
const pending = () => timers.filter((t) => t.live);
const flush = () => new Promise<void>((r) => setImmediate(r));

beforeEach(() => {
  sockets = [];
  timers = [];
  token = 'stored-token';
  tokenUrl = 'ws://gw';
  gwUrl = 'ws://gw';
  client = new LinkClient({
    getGatewayUrl: () => gwUrl,
    getToken: () => (token ? { url: tokenUrl, token } : null),
    setToken: (c) => {
      token = c ? c.token : '';
    },
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'W', system: 'dnd5e', systemVersion: '5' },
      user: { id: 'u', name: 'Gm', role: 4, isGM: true },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: () => {},
    random: () => 0,
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as Timer).live = false;
    },
  });
});

const welcome = {
  type: 'welcome',
  gatewayVersion: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  connectionId: 'c1',
  agentId: 'a1',
};
const last = () => sockets[sockets.length - 1]!;
async function connected() {
  client.start();
  last().onopen?.();
  last().recv(welcome);
  await flush();
  expect(client.state.kind).toBe('connected');
}
const drop = (code: number, reason = '') => last().onclose?.({ code, reason } as any);
const fire = () => {
  const t = pending()[0]!;
  t.live = false;
  t.fn();
};

it('retries a dropped link with backoff and always with the stored token', async () => {
  await connected();
  drop(1006);
  for (let n = 0; n < 3; n++) {
    expect(pending()).toHaveLength(1);
    expect(pending()[0]!.ms).toBe(backoffDelay(n, 0));
    fire();
    last().onopen?.();
    expect(last().sent[0].auth).toEqual({ kind: 'pairingToken', token: 'stored-token' });
    drop(1006);
  }
  for (const s of sockets) for (const m of s.sent) expect(m.auth.kind).toBe('pairingToken');
});

it('a 1008 PAIRING_INVALID close without a reject stops retrying and clears the token', async () => {
  await connected();
  drop(1008, 'PAIRING_INVALID');
  await flush();
  expect(pending()).toHaveLength(0);
  expect(token).toBe('');
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

it('a token-auth reject clears the token, reports TOKEN_REJECTED and schedules nothing', async () => {
  client.start();
  last().onopen?.();
  last().recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  expect(token).toBe('');
  expect(pending()).toHaveLength(0);
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'TOKEN_REJECTED' });
});

it('a code-auth reject keeps the token and falls back to it', async () => {
  client.pair('AAAA-BBBB');
  last().onopen?.();
  expect(last().sent[0].auth.kind).toBe('pairingCode');
  last().recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  expect(token).toBe('stored-token');
  expect(sockets).toHaveLength(2);
  last().onopen?.();
  expect(last().sent[0].auth).toEqual({ kind: 'pairingToken', token: 'stored-token' });
});

it('start() with a token for another gateway needs pairing and sends nothing', () => {
  tokenUrl = 'ws://elsewhere';
  client.start();
  expect(sockets).toHaveLength(0);
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
});

it('retryNow connects at once while a retry is pending, keeping the attempt count', async () => {
  await connected();
  drop(1006);
  expect(pending()[0]!.ms).toBe(backoffDelay(0, 0));
  client.retryNow();
  expect(pending()).toHaveLength(0);
  expect(sockets).toHaveLength(2);
  expect(client.state.kind).toBe('connecting');
  drop(1006);
  expect(pending()[0]!.ms).toBe(backoffDelay(1, 0));
});

it('retryNow does nothing when connected, connecting, stopped, replaced or rejected', async () => {
  client.retryNow();
  expect(sockets).toHaveLength(0);
  await connected();
  client.retryNow();
  expect(sockets).toHaveLength(1);
  drop(1006);
  client.retryNow(); // connecting now
  expect(sockets).toHaveLength(2);
  client.retryNow();
  expect(sockets).toHaveLength(2);
  last().onopen?.();
  last().recv(welcome);
  await flush();
  drop(1000, 'replaced');
  client.retryNow();
  expect(client.state).toEqual({ kind: 'disconnected', reason: 'REPLACED' });
  expect(sockets).toHaveLength(2);

  client.start();
  drop(1006);
  client.stop();
  client.retryNow();
  expect(sockets).toHaveLength(3);

  client.start();
  last().onopen?.();
  last().recv({ type: 'reject', code: 'PAIRING_INVALID', message: 'no' });
  await flush();
  const n = sockets.length;
  client.retryNow();
  expect(sockets).toHaveLength(n);
});
