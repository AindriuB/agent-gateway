import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
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
