import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  cliPath,
  freePort,
  pairingCode,
  RealModule,
  sleep,
  startCli,
  statusCount,
  tempState,
  until,
  type Cli,
} from './harness.js';

const TOKEN_LINE = /HTTP bearer token \(shown once, stored hashed\): (\S+)/;
const count = (text: string, needle: string): number => text.split(needle).length - 1;

const stdioWorldInfo = async (c: Cli) => {
  const r = await c.client.callTool({ name: 'world_info', arguments: {} });
  if (r.isError) throw new Error(JSON.stringify(r.content));
  return JSON.stringify(r.content);
};
async function eventually<T>(fn: () => Promise<T>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (Date.now() > end) throw err;
      await sleep(250);
    }
  }
}
const mcpStatus = (httpPort: number, token: string): Promise<number> =>
  fetch(`http://127.0.0.1:${httpPort}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    }),
  }).then((r) => r.status);

describe('offline end-to-end takeover: A (stdio) yields to B (--http) and takes back over', () => {
  const clis: Cli[] = [];
  const httpClients: Client[] = [];
  const modules: RealModule[] = [];
  const cleanups: (() => void)[] = [];
  afterEach(async () => {
    for (const h of httpClients.splice(0)) await h.close().catch(() => undefined);
    for (const m of modules.splice(0)) m.close();
    for (const c of clis.splice(0)) {
      await c.close();
      try {
        process.kill(c.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
    for (const f of cleanups.splice(0)) f();
  });

  it('runs the whole sequence with one shared state dir', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const httpPort = await freePort();

    // 1. A is a stdio instance with a real LinkClient linked and its own MCP stdio client.
    const a = await startCli(port, state.db);
    clis.push(a);
    await until(() => /Pairing code: /.test(a.stderr()), 10_000, 'A pairing code');
    const module = new RealModule(port);
    modules.push(module);
    module.pair(pairingCode(a));
    await until(() => module.connected, 15_000, 'module linked to A');
    expect(await stdioWorldInfo(a)).toContain('echo:');

    // 2. B (--http, different settings) takes over; A stays alive as a secondary behind B.
    const b = await startCli(port, state.db, ['--http', '--http-port', String(httpPort)]);
    clis.push(b);
    await until(() => b.stderr().includes('MCP HTTP at'), 30_000, 'B serving HTTP');
    expect(await eventually(() => stdioWorldInfo(a))).toContain('echo:');
    expect(() => process.kill(a.pid, 0)).not.toThrow();
    expect(a.stderr()).toContain('stepping down');
    expect(a.stderr()).toMatch(/this instance relays to it and cannot pair/);

    // 3. The real LinkClient reconnects to B, with exactly one connection.
    await eventually(async () => {
      if (!module.connected || (await statusCount(httpPort)) !== 1) throw new Error('not yet');
    });

    // Part 3: B went on to become the primary, so it never claimed otherwise.
    expect(b.stderr()).not.toContain('cannot pair');
    expect(b.stderr()).not.toContain('HTTP is served only by the primary');
    expect(b.stderr()).not.toContain('[error]');
    expect(a.stderr()).not.toContain('[error]');

    // 4. An MCP SDK client over Streamable HTTP with the bearer token gets world_info.
    const token = TOKEN_LINE.exec(b.stderr())![1]!;
    const connectHttp = async (t: string): Promise<Client> => {
      const c = new Client({ name: 'http', version: '0' });
      await c.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${t}` } },
        }),
      );
      httpClients.push(c);
      return c;
    };
    const viaHttp = await connectHttp(token);
    const r = await viaHttp.callTool({ name: 'world_info', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(JSON.stringify(r.content)).toContain('echo:');

    // 5. --http-rotate-token: the old token gets 401 and the new one 200.
    expect(await mcpStatus(httpPort, token)).toBe(200);
    const newToken = rotateToken(state.db);
    expect(await mcpStatus(httpPort, token)).toBe(401);
    expect(await mcpStatus(httpPort, newToken)).toBe(200);

    // 6. B is killed. A takes over, the LinkClient reconnects to A, and A's stdio client works.
    await viaHttp.close().catch(() => undefined);
    const holds = count(a.stderr(), 'holds link port');
    process.kill(b.pid, 'SIGKILL');
    await until(() => count(a.stderr(), 'holds link port') > holds, 30_000, 'A takes back over');
    const callsBefore = module.calls.length;
    await eventually(async () => {
      if (!module.connected) throw new Error('module not linked to A yet');
      await stdioWorldInfo(a);
    });
    expect(module.calls.length).toBeGreaterThan(callsBefore);
    // A was not started with --http, so it does not serve HTTP after taking back over.
    expect(await statusCount(httpPort)).toBeUndefined();
  }, 180_000);
});

/** Run the one-shot rotate and return the token it prints once on stderr. */
function rotateToken(db: string): string {
  const r = spawnSync(process.execPath, [cliPath, '--http-rotate-token', '--db', db], {
    env: { PATH: process.env.PATH ?? '', HOME: tmpdir() },
    encoding: 'utf8',
  });
  const m = TOKEN_LINE.exec(r.stderr);
  if (!m) throw new Error(`rotate printed no token: ${r.stderr}`);
  return m[1]!;
}
