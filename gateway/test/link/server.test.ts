import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { PROTOCOL_VERSION, checkCompat } from '@agent-gateway/protocol';
import {
  LinkCallError,
  LinkRegistry,
  LinkServer,
  PairingCodes,
  hashToken,
} from '../../src/link/index.js';
import { openStore } from '../../src/store/index.js';
import { TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});
async function connect(port: number): Promise<TestClient> {
  const c = await TestClient.connect(port);
  clients.push(c);
  return c;
}

describe('LinkServer binding and origin', () => {
  it('binds 127.0.0.1 by default and refuses other hosts without the option', async () => {
    h = await startServer();
    expect((h.server as unknown as { host: string }).host).toBe('127.0.0.1');
    const base = {
      port: 0,
      store: h.store,
      codes: h.codes,
      registry: h.registry,
      allowedOrigins: [],
      gatewayVersion: '0',
    };
    expect(() => new LinkServer({ ...base, host: '0.0.0.0' })).toThrow(/allowNonLoopback/);
    expect(
      () => new LinkServer({ ...base, host: '0.0.0.0', allowNonLoopback: true }),
    ).not.toThrow();
  });

  it('refuses connections from origins outside the allowlist, and with none', async () => {
    h = await startServer();
    await expect(TestClient.connect(h.port, 'http://evil.example')).rejects.toThrow(/403/);
    await expect(TestClient.connect(h.port, null)).rejects.toThrow(/403/);
    const ok = await connect(h.port);
    expect(ok.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('PairingCodes', () => {
  it('generates XXXX-XXXX single-use codes that expire after 10 minutes', () => {
    let t = 0;
    const codes = new PairingCodes(() => t);
    const code = codes.generate();
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(codes.consume(code)).toBe(true);
    expect(codes.consume(code)).toBe(false);
    const late = codes.generate();
    t = 10 * 60 * 1000;
    expect(codes.consume(late)).toBe(false);
    const fine = codes.generate();
    t += 10 * 60 * 1000 - 1;
    expect(codes.consume(fine)).toBe(true);
  });

  it('prunes expired unused codes when generating', () => {
    let t = 0;
    const codes = new PairingCodes(() => t);
    codes.generate();
    codes.generate();
    expect(codes.size).toBe(2);
    t = 10 * 60 * 1000;
    codes.generate();
    expect(codes.size).toBe(1);
  });
});

describe('handshake', () => {
  it('pairs with a code, issues a token stored only as a hash, then accepts the token', async () => {
    h = await startServer();
    const code = h.codes.generate();
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code }));
    const w = await c.next();
    expect(w).toMatchObject({ type: 'welcome', protocolVersion: PROTOCOL_VERSION });
    if (w.type !== 'welcome') return;
    expect(w.pairingToken).toBeTruthy();
    const token = w.pairingToken as string;
    expect(h.store.findPairingByHash(hashToken(token))?.id).toBe(w.agentId);
    expect(readFileSync(h.dbPath).includes(token)).toBe(false);
    expect(h.registry.get('w1', 'u1')?.agentId).toBe(w.agentId);

    const c2 = await connect(h.port);
    c2.send(hello({ kind: 'pairingToken', token }));
    const w2 = await c2.next();
    expect(w2).toMatchObject({ type: 'welcome', agentId: w.agentId });
    expect((w2 as { pairingToken?: string }).pairingToken).toBeUndefined();
  });

  it('rejects reused and unknown codes with PAIRING_INVALID', async () => {
    h = await startServer();
    const code = h.codes.generate();
    const a = await connect(h.port);
    a.send(hello({ kind: 'pairingCode', code }));
    await a.next('welcome');
    const b = await connect(h.port);
    b.send(hello({ kind: 'pairingCode', code }, { userId: 'u2' }));
    expect(await b.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    await b.untilClosed();
  });

  it('rejects expired codes', async () => {
    let t = 0;
    const codes = new PairingCodes(() => t);
    h = await startServer({ codes });
    const code = codes.generate();
    t = 11 * 60 * 1000;
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code }));
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
  });

  it('rejects revoked tokens and tokens for another world or user', async () => {
    h = await startServer();
    const token = 'tok';
    const row = h.store.createPairing({
      id: 'p1',
      tokenHash: hashToken(token),
      worldId: 'w1',
      userId: 'u1',
    });
    const other = await connect(h.port);
    other.send(hello({ kind: 'pairingToken', token }, { userId: 'u9' }));
    expect(await other.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    h.store.revokePairing(row.id);
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingToken', token }));
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
  });

  it.each(['1.0.0', '1.99.7', '2.0.0', '2.99.7'])(
    'rejects legacy module %s before welcome or consuming its pairing code',
    async (legacy) => {
      h = await startServer();
      const code = h.codes.generate();
      const c = await connect(h.port);
      c.send(hello({ kind: 'pairingCode', code }, { protocolVersion: legacy }));
      const expected = checkCompat(PROTOCOL_VERSION, legacy);
      expect(expected.ok).toBe(false);
      const reject = await c.next();
      expect(reject).toMatchObject({
        type: 'reject',
        code: 'PROTOCOL_MAJOR_MISMATCH',
        message: expected.ok ? '' : expected.message,
      });
      if (reject.type !== 'reject') throw new Error('Expected a protocol rejection');
      expect(reject.message).toContain(`local ${PROTOCOL_VERSION}, remote ${legacy}`);
      expect(reject.message).toMatch(/upgrade the remote side/i);
      await c.untilClosed();
      expect(c.messages).toEqual([]);
      expect(h.registry.list()).toEqual([]);
      expect(h.store.listActivePairings()).toEqual([]);
      expect(h.codes.consume(code)).toBe(true);
    },
  );

  it('rejects a major protocol mismatch with the checkCompat message', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: 'AAAA-AAAA' }, { protocolVersion: '9.0.0' }));
    const expected = checkCompat(PROTOCOL_VERSION, '9.0.0');
    expect(expected.ok).toBe(false);
    expect(await c.next()).toMatchObject({
      type: 'reject',
      code: 'PROTOCOL_MAJOR_MISMATCH',
      message: expected.ok ? '' : expected.message,
    });
  });

  it('closes sockets whose first message is not a valid hello', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.ws.send('not json');
    expect((await c.next()).type).toBe('reject');
    await c.untilClosed();
  });
});

describe('registry over the wire', () => {
  async function pair(hh: Harness, userId = 'u1'): Promise<TestClient> {
    const c = await connect(hh.port);
    c.send(hello({ kind: 'pairingCode', code: hh.codes.generate() }, { userId }));
    await c.next('welcome');
    return c;
  }

  it('routes calls to result/error frames and fails pending calls on disconnect', async () => {
    h = await startServer();
    const events: string[] = [];
    h.registry.on('connected', () => events.push('connected'));
    h.registry.on('disconnected', () => events.push('disconnected'));
    const c = await pair(h);
    const conn = h.registry.get('w1', 'u1')!;

    const p1 = h.registry.call(conn, 'roll', { n: 1 }, 1000);
    const call1 = await c.next('call');
    expect(call1).toMatchObject({ tool: 'roll', args: { n: 1 } });
    c.send({
      type: 'result',
      id: (call1 as { id: string }).id,
      ok: true,
      text: 'done',
      structured: { a: 1 },
    });
    await expect(p1).resolves.toEqual({ text: 'done', structured: { a: 1 } });

    const p2 = h.registry.call(conn, 'roll', {}, 1000);
    const call2 = await c.next('call');
    c.send({ type: 'error', id: (call2 as { id: string }).id, code: 'FORBIDDEN', message: 'no' });
    await expect(p2).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const p3 = h.registry.call(conn, 'slow', {}, 5000);
    await c.next('call');
    c.ws.close();
    await expect(p3).rejects.toMatchObject({ code: 'WORLD_OFFLINE' });
    await expect(h.registry.call(conn, 'again', {}, 100)).rejects.toBeInstanceOf(LinkCallError);
    expect(h.registry.get('w1', 'u1')).toBeUndefined();
    expect(events).toEqual(['connected', 'disconnected']);
  });

  it('times out calls that get no answer', async () => {
    h = await startServer();
    await pair(h);
    await expect(h.registry.call(h.registry.get('w1', 'u1')!, 't', {}, 20)).rejects.toThrow(
      /timed out/,
    );
  });

  it('replaces a stale duplicate connection for the same world and user', async () => {
    h = await startServer();
    const first = await pair(h);
    const old = h.registry.get('w1', 'u1')!;
    const settled = h.registry.call(old, 'x', {}, 5000).then(
      () => undefined,
      (e: unknown) => e,
    );
    await pair(h);
    expect(h.registry.get('w1', 'u1')).not.toBe(old);
    expect(await settled).toMatchObject({ code: 'WORLD_OFFLINE' });
    await first.untilClosed();
    expect(h.registry.get('w1', 'u1')).toBeDefined();
    expect(h.registry.list()).toHaveLength(1);
  });

  it('holds several users at once', async () => {
    h = await startServer();
    await pair(h, 'u1');
    await pair(h, 'u2');
    expect(h.registry.list()).toHaveLength(2);
  });
});

it('opens the store type used by the harness', () => {
  expect(openStore(':memory:')).toBeDefined();
  expect(new LinkRegistry()).toBeDefined();
});

const eventFrame = (userId = 'u1') => ({
  type: 'event',
  event: { seq: 1, ts: 0, type: 'chat', userId, summary: 'A chat message was posted' },
});
describe('Task27 event admission', () => {
  it('rejects an event before hello without consuming a pairing', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.send(eventFrame());
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'INVALID_ARGS' });
    await c.untilClosed();
    expect(h.registry.list()).toEqual([]);
    expect(h.store.listActivePairings()).toEqual([]);
  });
  it('accepts and drops authenticated events while preserving ping and tool transport', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    expect(await c.next()).toMatchObject({ type: 'welcome' });
    c.send(eventFrame());
    c.send({ type: 'ping' });
    expect(await c.next()).toEqual({ type: 'pong' });
    expect(c.closed).toBe(false);
    const conn = h.registry.get('w1', 'u1')!;
    const pending = h.registry.call(conn, 'read', { limit: 1 }, 1000);
    const call = await c.next('call');
    expect(call).toMatchObject({ tool: 'read', args: { limit: 1 } });
    c.send({ type: 'result', id: (call as { id: string }).id, ok: true, text: 'done' });
    await expect(pending).resolves.toEqual({ text: 'done', structured: undefined });
    expect(c.messages).toEqual([]);
  });
  it('refuses a relabeled observer after authentication', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c.next();
    c.send(eventFrame('other'));
    await c.untilClosed();
    expect(h.registry.list()).toEqual([]);
  });
  it('refuses extra document data in an authenticated event', async () => {
    h = await startServer();
    const c = await connect(h.port);
    c.send(hello({ kind: 'pairingCode', code: h.codes.generate() }));
    await c.next();
    c.send({ ...eventFrame(), event: { ...eventFrame().event, data: { secret: true } } });
    await c.untilClosed();
    expect(h.registry.list()).toEqual([]);
  });
});
