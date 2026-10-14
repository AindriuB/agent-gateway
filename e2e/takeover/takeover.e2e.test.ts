import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadContext } from '../lib/context.js';
import { GATEWAY_CLI, GatewayProcess } from '../lib/gateway.js';
import { waitFor } from '../multi/frames.js';
import { Rig, RECONNECT_MS } from '../multi/rig.js';
import { parseBearerToken, parseConnectedCount, takeoverArgs } from './helpers.js';

const ctx = loadContext();
const { gmUser } = ctx.config;
const TEST_TIMEOUT_MS = 300_000;

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
const alive = (pid: number | null): boolean => {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const status = async (httpPort: number): Promise<number | undefined> =>
  fetch(`http://127.0.0.1:${httpPort}/status`).then(
    async (r) => parseConnectedCount(await r.text()),
    () => undefined,
  );
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
        clientInfo: { name: 'e2e', version: '0' },
      },
    }),
  }).then((r) => r.status);

/** Rotate the e2e db's HTTP token with the built CLI and return the new one (shown once). */
const rotateToken = (): string | undefined => {
  const r = spawnSync(
    process.execPath,
    [GATEWAY_CLI, '--http-rotate-token', '--db', ctx.paths.db],
    {
      encoding: 'utf8',
    },
  );
  return parseBearerToken(`${r.stdout}\n${r.stderr}`);
};

describe('takeover: the e2e gateway A yields to a newer --http gateway B and takes back over', () => {
  let rig: Rig;
  let b: GatewayProcess | undefined;
  let httpPort: number;
  beforeAll(async () => {
    httpPort = await freePort();
    rig = new Rig(ctx);
    await rig.open(gmUser, [gmUser]);
  });
  afterAll(async () => {
    await b?.stop();
    await rig?.close();
  });

  const infoA = () => rig.gateway!.call('world_info');

  it(
    'B takes over, A relays, HTTP and token rotation work, then A takes back over',
    async () => {
      expect((await infoA()).isError).toBe(false);
      const a = rig.gateway!;
      const welcomes = rig.frames(gmUser).welcomes;

      // 0. A has migrated the shared db. Rotate first so the test never depends on whether a
      // token hash was already stored (B prints a token only when the db has none).
      const token = rotateToken();
      expect(token, 'rotate printed a token').toBeDefined();

      // 1. B on the same e2e db: HTTP on, and a differing setting (the HTTP port).
      b = new GatewayProcess(ctx.config, ctx.paths, gmUser, takeoverArgs(httpPort));
      await b.start();

      // 2. The real module in the dev-gm page reconnects to B.
      const linked = await waitFor(async () => (await status(httpPort)) === 1, RECONNECT_MS, 500);
      expect(linked, 'B lists exactly one connection').toBeDefined();
      expect(rig.frames(gmUser).welcomes).toBeGreaterThan(welcomes);
      expect((await b.call('world_info')).isError).toBe(false);

      // 3. A is still alive and its stdio client works through the relay.
      expect(alive(a.childPid), 'A stays alive after stepping down').toBe(true);
      const relayed = await waitFor(async () => !(await infoA()).isError, 60_000, 500);
      expect(relayed, 'A world_info via the relay').toBeDefined();

      // 4. world_info over HTTP with the bearer token.
      const http = new Client({ name: 'e2e-http', version: '0' });
      await http.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`), {
          requestInit: { headers: { authorization: `Bearer ${token}` } },
        }),
      );
      try {
        const r = await http.callTool({ name: 'world_info', arguments: {} });
        expect(r.isError).toBeFalsy();
      } finally {
        await http.close().catch(() => undefined);
      }

      // 5. Rotate: the old token gets 401 and the new one 200.
      expect(await mcpStatus(httpPort, token!)).toBe(200);
      const fresh = rotateToken();
      expect(fresh, 'rotate printed a new token').toBeDefined();
      expect(await mcpStatus(httpPort, token!)).toBe(401);
      expect(await mcpStatus(httpPort, fresh!)).toBe(200);

      // 6. Stop B: A takes back over, the module reconnects, and A's stdio client works.
      const before = rig.frames(gmUser).welcomes;
      await b.stop();
      b = undefined;
      const back = await waitFor(
        async () => rig.frames(gmUser).welcomes > before && !(await infoA()).isError,
        RECONNECT_MS,
        1000,
      );
      expect(back, 'module reconnected to A and world_info works').toBeDefined();
      expect(alive(a.childPid)).toBe(true);
      expect(await status(httpPort), 'A does not serve HTTP').toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});
