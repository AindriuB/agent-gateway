import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createDegradedServer, STATUS_TOOL } from '../../src/mcp/degraded.js';

describe('degraded server', () => {
  it('answers the handshake and reports the conflict on every tool call', async () => {
    const server = createDegradedServer({ version: '1.2.3', reason: 'link port 7420 is in use' });
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual([STATUS_TOOL]);
    const res = await client.callTool({ name: 'anything', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('LINK_UNAVAILABLE: ');
    expect(JSON.stringify(res.content)).toContain('link port 7420 is in use');
  });
});

describe('second gateway instance (built cli)', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  const children: ChildProcessWithoutNullStreams[] = [];
  const dirs: string[] = [];
  afterEach(async () => {
    for (const c of children.splice(0)) {
      if (c.exitCode !== null) continue;
      c.kill();
      await new Promise((r) => c.once('close', r));
    }
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const freePort = (): Promise<number> =>
    new Promise((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address() as { port: number };
        s.close(() => resolve(port));
      });
    });
  function start(port: number, db: string) {
    const child = spawn(process.execPath, [cli, '--link-port', String(port), '--db', db], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    const lines: Record<string, unknown>[] = [];
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buf.slice(0, i)) as Record<string, unknown>);
        buf = buf.slice(i + 1);
      }
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const reply = async (id: number) => {
      for (let n = 0; n < 100; n++) {
        const hit = lines.find((l) => l.id === id);
        if (hit)
          return hit as {
            result?: { isError?: boolean; content?: unknown };
            error?: { code: number };
          };
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no reply to ${id}`);
    };
    return { child, send, reply };
  }

  it('stays up, answers MCP, and returns a JSON-RPC error for server/discover', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-conflict-'));
    dirs.push(dir);
    const port = await freePort();
    const db = join(dir, 'g.db');
    const first = start(port, db);
    first.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    await first.reply(1);

    const second = start(port, db);
    second.send({ jsonrpc: '2.0', id: 1, method: 'server/discover' });
    expect((await second.reply(1)).error?.code).toBe(-32601);
    second.send({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    expect((await second.reply(2)).result).toBeDefined();
    second.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    // The second instance relays to the primary, so it serves the full session, not gateway_status.
    second.send({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
    const list = await second.reply(3);
    expect(JSON.stringify(list.result)).toContain('world_info');
    expect(JSON.stringify(list.result)).not.toContain(
      'Explains why this gateway instance cannot reach Foundry',
    );
    expect(second.child.exitCode).toBeNull();
  }, 20_000);
});

describe('--allow-origin validation (built cli)', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  for (const bad of [
    'not a url',
    'foundry.local',
    'foundry.local:30000',
    'ftp://foundry.local',
    'file:///etc/passwd',
  ]) {
    it(`exits 2 naming ${bad}`, async () => {
      const child = spawn(process.execPath, [cli, `--allow-origin=${bad}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let err = '';
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      const code = await new Promise((r) => child.on('close', r));
      expect(code).toBe(2);
      expect(err.trim().split('\n')).toHaveLength(1);
      expect(err).toContain(bad);
      expect(err).toContain('include http:// or https://');
    });
  }
});

describe('startup failures and origins (built cli)', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  const dirs: string[] = [];
  const children: ChildProcessWithoutNullStreams[] = [];
  const servers: ReturnType<typeof createNetServer>[] = [];
  afterEach(async () => {
    for (const c of children.splice(0)) {
      if (c.exitCode !== null) continue;
      c.kill();
      await new Promise((r) => c.once('close', r));
    }
    for (const sv of servers.splice(0)) await new Promise((r) => sv.close(r));
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'ag-start-'));
    dirs.push(d);
    return d;
  };
  const hold = (): Promise<number> =>
    new Promise((resolve) => {
      const sv = createNetServer().listen(0, '127.0.0.1', () => {
        servers.push(sv);
        resolve((sv.address() as { port: number }).port);
      });
    });
  const freePort = async (): Promise<number> => {
    const port = await hold();
    await new Promise((r) => servers.pop()?.close(r));
    return port;
  };
  const helloMsg = (auth: object) => ({
    type: 'hello',
    protocolVersion: PROTOCOL_VERSION,
    moduleVersion: '0.0.0',
    foundryVersion: '13.0',
    world: { id: 'w1', title: 'W', system: 'dnd5e', systemVersion: '5' },
    user: { id: 'u1', name: 'U', role: 4, isGM: true },
    auth,
  });
  const run = (args: string[], env: Record<string, string> = {}) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    children.push(child);
    let err = '';
    let out = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    return { child, err: () => err, out: () => out };
  };
  const waitFor = async (cond: () => boolean, ms = 5000) => {
    for (let n = 0; n < ms / 50 && !cond(); n++) await new Promise((r) => setTimeout(r, 50));
    expect(cond()).toBe(true);
  };

  it('exits 1 for a corrupt db when the port is free', async () => {
    const dir = tmp();
    const db = join(dir, 'g.db');
    writeFileSync(db, 'this is not a sqlite database'.repeat(100));
    const r = run(['--link-port', String(await freePort()), '--db', db]);
    const code = await new Promise((res) => r.child.on('close', res));
    expect(code).toBe(1);
    expect(r.err()).toContain('Failed to start');
  }, 20_000);

  it('goes degraded when the port is taken, without touching the db', async () => {
    const dir = tmp();
    const db = join(dir, 'g.db');
    const seed = new DatabaseSync(db);
    seed.exec('CREATE TABLE t (a)');
    seed.close();
    const before = statSync(db);
    const port = await hold();
    const r = run(['--link-port', String(port), '--db', db]);
    r.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 't', version: '0' },
        },
      })}\n`,
    );
    // The instance first tries to relay to whoever holds the port; a plain listener has no relay,
    // so the bounded retries run out (about 11 s) before the degraded server answers.
    await waitFor(() => r.out().includes('"id":1'), 20_000);
    const errLines = r.err().trim().split('\n');
    expect(errLines[0]).toBe(
      `[error] pid ${r.child.pid}: another gateway holds link port ${port}; this instance cannot pair`,
    );
    expect(r.err()).not.toContain('Pairing code');
    expect(r.err()).not.toContain('MCP stdio server started');
    expect(r.err()).toContain('relay unavailable, serving gateway_status only');
    expect(r.child.exitCode).toBeNull();
    const after = statSync(db);
    expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
    expect(readdirSync(dir)).toEqual(['g.db']);
  }, 20_000);

  async function originAccepted(args: string[], origin: string): Promise<boolean> {
    const port = await freePort();
    const r = run(['--link-port', String(port), '--db', join(tmp(), 'g.db'), ...args]);
    await waitFor(() => r.err().includes('Link URL'));
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      ws.on('open', () => (ws.close(), resolve(true)));
      ws.on('error', () => resolve(false));
    });
  }

  it('prints the code and the pid only from the instance that holds the port', async () => {
    const port = await freePort();
    const db = join(tmp(), 'g.db');
    const primary = run(['--link-port', String(port), '--db', db]);
    await waitFor(() => primary.err().includes('Link URL'));
    expect(primary.err()).toContain('Pairing code: ');
    expect(primary.err()).toContain(`pid ${primary.child.pid} holds link port ${port}`);
  }, 20_000);

  it('elects exactly one primary among concurrent fresh starts', async () => {
    for (let i = 0; i < 20; i++) {
      const port = await freePort();
      const db = join(tmp(), 'g.db');
      const rs = [0, 1, 2, 3].map(() => run(['--link-port', String(port), '--db', db]));
      await waitFor(() => rs.every((r) => /Pairing code|cannot pair/.test(r.err())));
      expect(rs.filter((r) => r.err().includes('Pairing code'))).toHaveLength(1);
      expect(rs.filter((r) => r.err().includes('cannot pair'))).toHaveLength(3);
      // Every non-holder now serves the full tool set through the relay.
      for (const r of rs.filter((x) => x.err().includes('cannot pair'))) {
        r.child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } })}\n`,
        );
        r.child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`,
        );
        r.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
      }
      await waitFor(
        () =>
          rs
            .filter((x) => x.err().includes('cannot pair'))
            .every((x) => x.out().includes('"id":2')),
        20_000,
      );
      for (const r of rs.filter((x) => x.err().includes('cannot pair'))) {
        expect(r.out()).toContain('world_info');
        expect(r.out()).not.toContain('Explains why this gateway instance cannot reach Foundry');
      }
      for (const r of rs) expect(r.child.exitCode).toBeNull();
      for (const r of rs.splice(0)) {
        r.child.kill();
        await new Promise((res) => r.child.once('close', res));
      }
    }
  }, 120_000);

  /** One WebSocket exchange: send `msg`, resolve with the first reply, or with 'refused' on a failed upgrade. */
  const exchange = (port: number, origin: string, msg?: object) =>
    new Promise<Record<string, unknown> | 'refused'>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
      ws.on('error', () => resolve('refused'));
      ws.on('open', () => msg && ws.send(JSON.stringify(msg)));
      ws.on('message', (d) => {
        resolve(JSON.parse(d.toString()) as Record<string, unknown>);
        ws.close();
      });
    });

  it('logs one line per distinct (origin, reason), sanitised, without a Foundry URL hint', async () => {
    const port = await freePort();
    const r = run(['--link-port', String(port), '--db', join(tmp(), 'g.db')]);
    await waitFor(() => r.err().includes('Link URL'));
    const bad = { kind: 'pairingCode', code: 'AAAA-AAAA' } as const;
    expect(await exchange(port, 'https://evil.example', helloMsg(bad))).toMatchObject({
      code: 'PAIRING_INVALID',
    });
    await exchange(port, 'https://evil.example', helloMsg(bad));
    // A long origin is canonical only up to 255 characters, so it reaches hello and is truncated in the log.
    const long = `https://${'a'.repeat(240)}.com`;
    await exchange(port, long, helloMsg(bad));
    await exchange(port, 'null');
    await waitFor(() => r.err().includes('aaaa') && r.err().includes('origin null'));
    const lines = r
      .err()
      .split('\n')
      .filter((l) => l.startsWith('rejected link connection'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('origin https://evil.example: no valid pairing code');
    expect(lines[0]).toContain('The code is in this log or the client');
    expect(lines[1]).toContain('...');
    expect(lines[1].length).toBeLessThan(400);
    expect(lines[2]).toContain('origin null: origin is not an allowed browser origin');
    expect(r.err()).not.toContain('Foundry URL');
  }, 20_000);

  it('pairs from any origin with the code and holds the token to that origin', async () => {
    const port = await freePort();
    const r = run(['--link-port', String(port), '--db', join(tmp(), 'g.db')]);
    await waitFor(() => r.err().includes('Pairing code: '));
    const code = /Pairing code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(r.err())![1]!;
    const first = await exchange(
      port,
      'https://foundry.local',
      helloMsg({ kind: 'pairingCode', code }),
    );
    expect(first).toMatchObject({ type: 'welcome' });
    const token = (first as { pairingToken: string }).pairingToken;
    // Hold a live connection from the paired origin, then replay the token from another one.
    const live = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'https://foundry.local' });
    const liveReply = new Promise<Record<string, unknown>>((res) =>
      live.once('message', (d) => res(JSON.parse(d.toString()) as Record<string, unknown>)),
    );
    await new Promise((res) => live.once('open', res));
    live.send(JSON.stringify(helloMsg({ kind: 'pairingToken', token })));
    expect(await liveReply).toMatchObject({ type: 'welcome' });
    const replay = await exchange(
      port,
      'http://foundry.local',
      helloMsg({ kind: 'pairingToken', token }),
    );
    expect(replay).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect(live.readyState).toBe(WebSocket.OPEN);
    live.close();
  }, 20_000);

  it('warns that a retired role setting is ignored, and still starts', async () => {
    const port = await freePort();
    const r = run(['--link-port', String(port), '--db', join(tmp(), 'g.db')], {
      AGENT_GATEWAY_ROLE: 'gm',
    });
    await waitFor(() => r.err().includes('Link URL'));
    expect(r.err()).toContain(
      'AGENT_GATEWAY_ROLE / config "role" is ignored: the tool tier comes from the Foundry user\'s role',
    );
  }, 20_000);

  it('accepts a normalised --allow-origin', async () => {
    const args = ['--allow-origin=http://Foundry.Local:30000/'];
    expect(await originAccepted(args, 'http://foundry.local:30000')).toBe(true);
  }, 20_000);

  it('rejects other origins when --allow-origin is set', async () => {
    const args = ['--allow-origin=http://Foundry.Local:30000/'];
    expect(await originAccepted(args, 'http://localhost:30000')).toBe(false);
  }, 20_000);

  it('treats an empty --allow-origin= as no restriction', async () => {
    expect(await originAccepted(['--allow-origin='], 'https://foundry.local')).toBe(true);
  }, 20_000);
});

describe('sanitizeOrigin', () => {
  it('bounds and escapes untrusted text', async () => {
    const { sanitizeOrigin } = await import('../../src/app.js');
    expect(sanitizeOrigin(undefined)).toBe('(absent)');
    expect(sanitizeOrigin('http://a b\r\n\x1b[31m')).toBe('http://a?b???[31m');
    expect(sanitizeOrigin('x'.repeat(500))).toHaveLength(103);
  });
});
