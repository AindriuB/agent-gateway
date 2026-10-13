import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { connect, createServer as createNetServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkRegistry } from '../../src/link/index.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { toolsets } from '../../src/routing/index.js';
import {
  connectRelay,
  makeRelayConfig,
  MAX_RELAY_BUFFERED_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_SESSIONS,
  RelayServer,
  relayEndpoint,
  type SocketUpstream,
} from '../../src/relay/index.js';
import { sleep, until } from './harness.js';

// Deterministic session ids: the Nth session server made in this file is `sess-N`.
const ids = vi.hoisted(() => ({ n: 0, on: false }));
vi.mock('node:crypto', async (orig) => {
  const real = await orig<typeof import('node:crypto')>();
  return { ...real, randomUUID: () => (ids.on ? `sess-${++ids.n}` : real.randomUUID()) };
});

const PORT = 7777;
const CFG = makeRelayConfig('player', ['http://localhost:30000'], 1000);

interface Rig {
  dir: string;
  sock: string;
  server: RelayServer;
  create: ReturnType<typeof vi.fn>;
  logs: string[];
}
const rigs: Rig[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const s of sockets.splice(0)) s.destroy();
  for (const r of rigs.splice(0)) {
    await r.server.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
});

async function rig(
  over: {
    create?: () => Server;
    selector?: { world?: string; user?: string };
    onStepDown?: (why: string) => void;
  } = {},
): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), 'agr-'));
  chmodSync(dir, 0o700);
  const ep = relayEndpoint(dir);
  if (!ep.ok) throw new Error(ep.reason);
  const logs: string[] = [];
  const create = vi.fn(
    over.create ?? (() => new Server({ name: 't', version: '0' }, { capabilities: {} })),
  );
  const server = new RelayServer({
    endpoint: ep.path,
    stateDir: dir,
    linkPort: PORT,
    config: CFG,
    selector: over.selector ?? {},
    createSession: create,
    log: (l) => logs.push(l),
    ...(over.onStepDown ? { onStepDown: over.onStepDown } : {}),
  });
  await server.listen();
  const r = { dir, sock: ep.path, server, create, logs };
  rigs.push(r);
  return r;
}

const secretOf = (r: Rig) => readFileSync(join(r.dir, 'relay.secret'), 'utf8');

/** Send raw bytes as the first thing on a fresh connection and return the reply line. */
function rawHello(r: Rig, first: string | undefined): Promise<{ reply: string; closed: boolean }> {
  return new Promise((resolve) => {
    const s = connect(r.sock);
    sockets.push(s);
    let buf = '';
    s.on('connect', () => first !== undefined && s.write(first));
    s.on('data', (d) => (buf += d.toString()));
    s.on('close', () => resolve({ reply: buf.trim(), closed: true }));
    s.on('error', () => undefined);
  });
}
const hello = (r: Rig, over: object = {}) =>
  `${JSON.stringify({
    relay: 1,
    secret: secretOf(r),
    linkPort: PORT,
    config: CFG,
    selector: {},
    ...over,
  })}\n`;

describe('relay handshake', () => {
  it('refuses a wrong secret with RELAY_AUTH, closes, and creates no session', async () => {
    const r = await rig();
    const res = await rawHello(r, hello(r, { secret: 'f'.repeat(64) }));
    expect(JSON.parse(res.reply)).toEqual({ relay: 1, ok: false, code: 'RELAY_AUTH' });
    expect(res.closed).toBe(true);
    expect(r.create).not.toHaveBeenCalled();
  });

  it('refuses a missing secret with RELAY_AUTH', async () => {
    const r = await rig();
    const res = await rawHello(
      r,
      `${JSON.stringify({ relay: 1, linkPort: PORT, config: CFG, selector: {} })}\n`,
    );
    expect(JSON.parse(res.reply).code).toBe('RELAY_AUTH');
    expect(r.create).not.toHaveBeenCalled();
  });

  it('refuses the wrong link port', async () => {
    const r = await rig();
    const res = await rawHello(r, hello(r, { linkPort: PORT + 1 }));
    expect(JSON.parse(res.reply).code).toBe('RELAY_PORT_MISMATCH');
    expect(r.create).not.toHaveBeenCalled();
  });

  it('refuses a differing non-empty selector and reports the primary selector', async () => {
    const r = await rig({ selector: { user: 'gm' } });
    const res = await rawHello(r, hello(r, { selector: { user: 'someone-else' } }));
    expect(JSON.parse(res.reply)).toMatchObject({ code: 'RELAY_SELECTOR_MISMATCH' });
    expect(r.create).not.toHaveBeenCalled();
  });

  it('accepts an empty or equal selector', async () => {
    const r = await rig({ selector: { user: 'gm' } });
    for (const selector of [{}, { user: 'gm' }]) {
      const c = await connectRelay({
        endpoint: r.sock,
        stateDir: r.dir,
        linkPort: PORT,
        config: CFG,
        selector,
      });
      expect(c.kind).toBe('ok');
      if (c.kind === 'ok') c.upstream.close();
    }
  });

  it('refuses a malformed first line with RELAY_PROTOCOL', async () => {
    const r = await rig();
    for (const bad of [
      'not json\n',
      '[]\n',
      `${JSON.stringify({ relay: 2 })}\n`,
      `${'x'.repeat(5000)}\n`,
    ]) {
      const res = await rawHello(r, bad);
      expect(JSON.parse(res.reply).code).toBe('RELAY_PROTOCOL');
    }
    expect(r.create).not.toHaveBeenCalled();
  });

  it('closes a connection that sends no handshake within 2 s', async () => {
    const r = await rig();
    const started = Date.now();
    const res = await rawHello(r, undefined);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
    expect(JSON.parse(res.reply).code).toBe('RELAY_PROTOCOL');
    expect(r.create).not.toHaveBeenCalled();
  }, 10_000);

  it('refuses the 17th session with RELAY_FULL', async () => {
    const r = await rig();
    const ups: SocketUpstream[] = [];
    for (let i = 0; i < MAX_RELAY_SESSIONS; i++) {
      const c = await connectRelay({
        endpoint: r.sock,
        stateDir: r.dir,
        linkPort: PORT,
        config: CFG,
        selector: {},
      });
      expect(c.kind).toBe('ok');
      if (c.kind === 'ok') ups.push(c.upstream);
    }
    const extra = await connectRelay({
      endpoint: r.sock,
      stateDir: r.dir,
      linkPort: PORT,
      config: CFG,
      selector: {},
    });
    expect(extra).toMatchObject({ kind: 'refused', code: 'RELAY_FULL' });
    ups[0]!.close();
    await until(() => r.server.sessionCount === MAX_RELAY_SESSIONS - 1);
    const again = await connectRelay({
      endpoint: r.sock,
      stateDir: r.dir,
      linkPort: PORT,
      config: CFG,
      selector: {},
    });
    expect(again.kind).toBe('ok');
    if (again.kind === 'ok') again.upstream.close();
    ups.forEach((u) => u.close());
  });
});

describe('relay config fingerprint', () => {
  const withConfig = (config: unknown) => (r: Rig) => hello(r, { config });

  it('refuses a differing config that is not newer, with the primary config, and creates no session', async () => {
    const r = await rig();
    for (const config of [
      { ...CFG, role: 'gm' },
      { ...CFG, origins: ['https://foundry.local'] },
      { ...CFG, role: 'gm', startedAt: CFG.startedAt }, // tie
      { ...CFG, role: 'gm', startedAt: CFG.startedAt - 1 },
      undefined,
    ]) {
      const res = await rawHello(r, withConfig(config)(r));
      const reply = JSON.parse(res.reply);
      expect(reply.code).toBe('RELAY_CONFIG_MISMATCH');
      expect(reply.config).toEqual(CFG);
    }
    expect(r.create).not.toHaveBeenCalled();
  });

  it('a strictly newer differing config makes the primary step down after the grace period', async () => {
    const stepped: string[] = [];
    const r = await rig({ onStepDown: (why) => stepped.push(why) });
    const res = await rawHello(
      r,
      hello(r, { config: { ...CFG, role: 'gm', startedAt: CFG.startedAt + 1 } }),
    );
    expect(JSON.parse(res.reply).code).toBe('RELAY_CONFIG_STEPDOWN');
    expect(r.create).not.toHaveBeenCalled();
    expect(stepped).toEqual([]); // still serving during the grace period
    await until(() => stepped.length === 1, 5000, 'step down');
    expect(stepped[0]).toContain('role player here vs gm there');
    // a second request does not step down twice
    await sleep(100);
    expect(stepped).toHaveLength(1);
  }, 10_000);

  it('serves a matching config regardless of start order', async () => {
    const r = await rig();
    const c = await connectRelay({
      endpoint: r.sock,
      stateDir: r.dir,
      linkPort: PORT,
      config: { ...CFG, origins: [...CFG.origins], startedAt: CFG.startedAt + 500 },
      selector: {},
    });
    expect(c.kind).toBe('ok');
    if (c.kind === 'ok') c.upstream.close();
  });
});

describe('relay security', () => {
  it('destroys a refused peer that keeps its side open, freeing the pre-auth slot', async () => {
    const r = await rig();
    const s = connect({ path: r.sock, allowHalfOpen: true });
    sockets.push(s);
    s.on('error', () => undefined);
    s.write('not json\n');
    s.resume();
    await until(() => r.server.socketCount === 1, 2000, 'socket accepted');
    await until(() => r.server.socketCount === 0, 3000, 'refused socket destroyed');
  });

  it('keeps the socket and secret at 0600 and the state dir at 0700 while running', async () => {
    if (process.platform === 'win32') return;
    const r = await rig();
    expect(statSync(r.sock).mode & 0o777).toBe(0o600);
    expect(statSync(join(r.dir, 'relay.secret')).mode & 0o777).toBe(0o600);
    expect(statSync(r.dir).mode & 0o777).toBe(0o700);
    expect(secretOf(r)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to start in a state dir other users can enter', async () => {
    if (process.platform === 'win32') return;
    const dir = mkdtempSync(join(tmpdir(), 'agr-'));
    chmodSync(dir, 0o755);
    const ep = relayEndpoint(dir);
    if (!ep.ok) throw new Error(ep.reason);
    const server = new RelayServer({
      endpoint: ep.path,
      stateDir: dir,
      linkPort: PORT,
      config: CFG,
      selector: {},
      createSession: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      log: () => undefined,
    });
    await expect(server.listen()).rejects.toThrow(/accessible to other users/);
    expect(existsSync(join(dir, 'relay.secret'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the socket and secret on close, and replaces a stale socket on start', async () => {
    const r = await rig();
    await r.server.close();
    expect(existsSync(r.sock)).toBe(false);
    expect(existsSync(join(r.dir, 'relay.secret'))).toBe(false);
    const stale = createNetServer();
    await new Promise<void>((res) => stale.listen(r.sock, res));
    stale.close();
    const second = new RelayServer({
      endpoint: r.sock,
      stateDir: r.dir,
      linkPort: PORT,
      config: CFG,
      selector: {},
      createSession: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      log: () => undefined,
    });
    await second.listen();
    await second.close();
  });
});

describe('relay session isolation', () => {
  it('cancels only the closing session and leaves no listeners behind', async () => {
    const registry = new LinkRegistry();
    const cancelled: string[] = [];
    const events = Object.assign(new (await import('node:events')).EventEmitter(), {
      cancelSession: (id: string) => cancelled.push(id),
    });
    const base = {
      connected: registry.listenerCount('connected'),
      disconnected: registry.listenerCount('disconnected'),
      toolset: toolsets.listenerCount('changed'),
      events: events.listenerCount('changed'),
    };
    const r = await rig({
      create: () =>
        createSessionServer({
          version: '0',
          registry,
          events: events as never,
        }),
    });
    const open = async () => {
      const c = await connectRelay({
        endpoint: r.sock,
        stateDir: r.dir,
        linkPort: PORT,
        config: CFG,
        selector: {},
      });
      if (c.kind !== 'ok') throw new Error(JSON.stringify(c));
      return c.upstream;
    };
    ids.on = true;
    ids.n = 0;
    const a = await open(); // sess-1
    const b = await open(); // sess-2
    expect(cancelled).toEqual([]);
    b.close();
    await until(() => cancelled.length === 1);
    expect(cancelled).toEqual(['sess-2']);
    expect(r.server.sessionCount).toBe(1);
    a.close();
    await until(() => cancelled.length === 2);
    expect(cancelled).toEqual(['sess-2', 'sess-1']);

    for (let i = 0; i < 20; i++) (await open()).close();
    await until(() => r.server.sessionCount === 0 && cancelled.length === 22);
    expect({
      connected: registry.listenerCount('connected'),
      disconnected: registry.listenerCount('disconnected'),
      toolset: toolsets.listenerCount('changed'),
      events: events.listenerCount('changed'),
    }).toEqual(base);
    ids.on = false;
    expect(r.logs.filter((l) => /^relay session \d+ opened$/.test(l))).toHaveLength(22);
    expect(r.logs.filter((l) => /^relay session \d+ closed$/.test(l))).toHaveLength(22);
  });
});

describe('relay back-pressure', () => {
  it('closes only the connection that sends an oversized line', async () => {
    const r = await rig();
    const open = async () => {
      const c = await connectRelay({
        endpoint: r.sock,
        stateDir: r.dir,
        linkPort: PORT,
        config: CFG,
        selector: {},
      });
      if (c.kind !== 'ok') throw new Error(JSON.stringify(c));
      return c.upstream;
    };
    const bad = await open();
    const good = await open();
    let badClosed = false;
    let goodClosed = false;
    bad.onClose = () => (badClosed = true);
    good.onClose = () => (goodClosed = true);
    const replies: unknown[] = [];
    good.onMessage = (m) => replies.push(m);
    // A raw oversized line, past the limit and without a newline until the end.
    const socket = (bad as unknown as { socket: Socket }).socket;
    socket.write(
      `{"jsonrpc":"2.0","method":"x","params":"${'a'.repeat(MAX_RELAY_LINE_BYTES + 10)}"}\n`,
    );
    await until(() => badClosed, 10_000, 'oversized connection closed');
    expect(goodClosed).toBe(false);
    good.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    await until(() => replies.length > 0, 5000, 'reply on the healthy connection');
    good.close();
  });

  it('destroys a peer that stops reading, with bounded memory growth', async () => {
    // A session that answers every tools/list with a 1 MiB result; the peer never reads.
    const big = 'z'.repeat(1024 * 1024);
    const r = await rig({
      create: () => {
        const s = new Server({ name: 't', version: '0' }, { capabilities: { tools: {} } });
        s.setRequestHandler(ListToolsRequestSchema, (() => ({ tools: [], pad: big })) as never);
        return s;
      },
    });
    const c = await connectRelay({
      endpoint: r.sock,
      stateDir: r.dir,
      linkPort: PORT,
      config: CFG,
      selector: {},
    });
    if (c.kind !== 'ok') throw new Error('connect');
    const socket = (c.upstream as unknown as { socket: Socket }).socket;
    socket.pause();
    let closed = false;
    c.upstream.onClose = () => (closed = true);
    c.upstream.send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    const before = process.memoryUsage().rss;
    for (let i = 1; i <= 200 && !closed; i++) {
      c.upstream.send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
      if (i % 5 === 0) await sleep(10);
    }
    await until(() => closed, 20_000, 'non-reading peer destroyed');
    // The kernel buffers some, the primary at most MAX_RELAY_BUFFERED_BYTES more.
    expect(process.memoryUsage().rss - before).toBeLessThan(64 * 1024 * 1024);
    expect(MAX_RELAY_BUFFERED_BYTES).toBe(8 * 1024 * 1024);
    await until(() => r.server.sessionCount === 0);
  }, 40_000);
});
