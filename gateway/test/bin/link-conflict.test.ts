import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import WebSocket from 'ws';
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
    second.send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: STATUS_TOOL, arguments: {} },
    });
    const call = await second.reply(3);
    expect(call.result?.isError).toBe(true);
    expect(JSON.stringify(call.result?.content)).toContain('LINK_UNAVAILABLE');
    expect(second.child.exitCode).toBeNull();
  }, 20_000);
});

describe('--allow-origin validation (built cli)', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  for (const bad of ['not a url', 'ftp://foundry.local', 'file:///etc/passwd']) {
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
  const run = (args: string[]) => {
    const child = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    children.push(child);
    let err = '';
    let out = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    return { child, err: () => err, out: () => out };
  };
  const waitFor = async (cond: () => boolean) => {
    for (let n = 0; n < 100 && !cond(); n++) await new Promise((r) => setTimeout(r, 50));
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
    await waitFor(() => r.out().includes('"id":1'));
    expect(r.err()).toContain(
      `[error] pid ${r.child.pid}: another gateway holds link port ${port}; this instance cannot pair`,
    );
    expect(r.err()).not.toContain('Pairing code');
    expect(r.err()).not.toContain('MCP stdio server started');
    expect(r.err().trim().split('\n')).toHaveLength(1);
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
      for (const r of rs) expect(r.child.exitCode).toBeNull();
      for (const r of rs.splice(0)) {
        r.child.kill();
        await new Promise((res) => r.child.once('close', res));
      }
    }
  }, 120_000);

  it('accepts a normalised --allow-origin', async () => {
    const args = ['--allow-origin=http://Foundry.Local:30000/'];
    expect(await originAccepted(args, 'http://foundry.local:30000')).toBe(true);
  }, 20_000);

  it('rejects other origins when --allow-origin is set', async () => {
    const args = ['--allow-origin=http://Foundry.Local:30000/'];
    expect(await originAccepted(args, 'http://localhost:30000')).toBe(false);
  }, 20_000);

  it('falls back to the default origins for an empty --allow-origin=', async () => {
    expect(await originAccepted(['--allow-origin='], 'http://localhost:30000')).toBe(true);
  }, 20_000);
});
