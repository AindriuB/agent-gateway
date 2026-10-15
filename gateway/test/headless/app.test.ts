import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { createApp, type App } from '../../src/app.js';
import { profileDir } from '../../src/headless/profile.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, TestClient, hello } from '../link/helpers.js';
import { freePort, tempState, until } from '../relay/harness.js';
import { FakeLauncher } from './fake-browser.js';

const W = 'w1';
const U = 'agentuser0000001';
type Config = Parameters<typeof createApp>[0];

const apps: App[] = [];
const clients: (Client | TestClient)[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) {
    if (c instanceof TestClient) c.ws.terminate();
    else await c.close().catch(() => undefined);
  }
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

async function boot(opts: {
  serverMode: boolean;
  state?: ReturnType<typeof tempState>;
  launcher?: FakeLauncher;
  linkPort?: number;
}) {
  const state = opts.state ?? tempState();
  if (!opts.state) cleanups.push(state.cleanup);
  const linkPort = opts.linkPort ?? (await freePort());
  let httpPort = await freePort();
  while (httpPort === linkPort) httpPort = await freePort();
  const launcher =
    opts.launcher ??
    new FakeLauncher({ ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => linkPort } });
  const lines: string[] = [];
  const config = {
    linkPort,
    httpPort,
    logLevel: 'error',
    serverMode: opts.serverMode,
    headlessFoundryUrl: ORIGIN,
    headlessWorld: W,
    headlessUser: U,
    headlessPassword: 'hunter2',
  } as unknown as Config;
  const app = createApp(config, {
    version: '0.0.0-test',
    dbPath: state.db,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    writeStatus: (l) => void lines.push(l),
    http: true,
    selector: { world: W, user: U },
    headless: {
      launcher,
      runner: {
        fetch: (async () =>
          new Response(JSON.stringify({ active: true, world: W }), {
            status: 200,
          })) as typeof fetch,
        pollMs: 3_600_000,
        linkGraceMs: 50,
        pairWaitMs: 5_000,
      },
    },
  });
  apps.push(app);
  await app.start();
  const token = (): string => {
    const line = lines.find((l) => l.startsWith('HTTP bearer token'));
    return /: (\S+)$/.exec(line ?? '')?.[1] ?? '';
  };
  const mcp = async (selector?: { world: string; user: string }) => {
    await until(() => token() !== '', 10_000, 'http token');
    const url = new URL(`http://127.0.0.1:${httpPort}/mcp`);
    const client = new Client({ name: 't', version: '0' });
    const notices: string[] = [];
    client.setNotificationHandler(
      LoggingMessageNotificationSchema,
      (n) => void notices.push(JSON.stringify(n.params)),
    );
    void selector;
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token()}` } },
      }),
    );
    clients.push(client);
    return { client, notices };
  };
  return { app, state, linkPort, httpPort, lines, launcher, mcp };
}

const text = (r: unknown): string => JSON.stringify(r);

describe.each([true, false])('unattended pairing, server mode %s', (serverMode) => {
  it('mints, pairs, answers world_info, and never shows the code', async () => {
    const t = await boot({ serverMode });
    await until(() => t.lines.some((l) => l.startsWith('link connected')), 10_000, 'agent link');
    const code = t.launcher.typedCodes[0]!;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(t.lines).toContain(`minted an invite for headless agent ${W}/${U} (redacted)`);

    // The runner launched on the per-agent profile with the session flag as an init script.
    expect(t.launcher.launches[0]!.profileDir).toBe(profileDir(t.state.dir, W, U));
    expect(t.launcher.launches[0]!.initScript).toContain('agent-gateway.headless');
    expect(t.launcher.navigations).toEqual([`${ORIGIN}/join`]);

    const { client, notices } = await t.mcp();
    const info = await client.callTool({ name: 'world_info', arguments: {} });
    expect(info.isError).toBeFalsy();
    const status = await client.callTool({ name: 'gateway_status', arguments: {} });
    const missing = await client
      .callTool({ name: 'world_info', arguments: {} })
      .catch((e: unknown) => String(e));
    const httpStatus = await (await fetch(`http://127.0.0.1:${t.httpPort}/status`)).text();
    const everything = [
      t.lines.join('\n'),
      text(status),
      text(missing),
      notices.join('\n'),
      httpStatus,
    ].join('\n');
    expect(everything).not.toContain(code);
    // The gateway classified the connection itself.
    expect(t.lines.join('\n')).not.toContain('claimed to be headless');
  });

  it('still refuses a code that is not a live invite, and a human code for the agent user', async () => {
    const t = await boot({ serverMode });
    await until(() => t.lines.some((l) => l.startsWith('link connected')), 10_000, 'agent link');
    const bad = await TestClient.connect(t.linkPort);
    clients.push(bad);
    bad.send(
      hello({ kind: 'pairingCode', code: 'AAAA-AAAA-AAAA' }, { worldId: W, userId: 'u-human' }),
    );
    expect(await bad.next()).toMatchObject({ code: 'PAIRING_INVALID' });
    const shared = t.lines.map((l) => /Pairing code: (\S+)/.exec(l)?.[1]).find(Boolean);
    if (!serverMode) {
      expect(shared).toBeTruthy();
      const human = await TestClient.connect(t.linkPort);
      clients.push(human);
      human.send(hello({ kind: 'pairingCode', code: shared! }, { worldId: W, userId: U }));
      expect(await human.next()).toMatchObject({ code: 'PAIRING_INVALID' });
      expect(t.lines.join('\n')).toContain('pairs only through the runner');
      const other = await TestClient.connect(t.linkPort);
      clients.push(other);
      other.send(hello({ kind: 'pairingCode', code: shared! }, { worldId: W, userId: 'u-human' }));
      expect(await other.next()).toMatchObject({ type: 'welcome' });
    } else {
      expect(shared).toBeUndefined();
    }
  });
});

describe('while the agent is not connected', () => {
  it('shows the typed invite code nowhere', async () => {
    const linkPort = await freePort();
    const launcher = new FakeLauncher({
      ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => linkPort },
    });
    launcher.noPair = true;
    const t = await boot({ serverMode: true, launcher, linkPort });
    await until(() => launcher.typedCodes.length > 0, 10_000, 'typed code');
    const code = launcher.typedCodes[0]!;
    const { client, notices } = await t.mcp();
    const err = await client.callTool({ name: 'world_info', arguments: {} });
    expect(err.isError).toBe(true);
    const status = await client.callTool({ name: 'gateway_status', arguments: {} });
    const httpStatus = await (await fetch(`http://127.0.0.1:${t.httpPort}/status`)).text();
    const everything = [
      t.lines.join('\n'),
      text(err),
      text(status),
      notices.join('\n'),
      httpStatus,
    ];
    expect(everything.join('\n')).not.toContain(code);
  });
});

describe('restart with the same profile', () => {
  it('reconnects with the stored token and mints no invite', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    const launcher = new FakeLauncher({
      ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => linkPort },
    });
    const first = await boot({ serverMode: true, state, launcher, linkPort });
    await until(
      () => first.lines.some((l) => l.startsWith('link connected')),
      10_000,
      'first link',
    );
    expect(launcher.typedCodes).toHaveLength(1);
    await first.app.stop();
    apps.splice(apps.indexOf(first.app), 1);

    const second = await boot({ serverMode: true, state, launcher, linkPort });
    await until(
      () => second.lines.some((l) => l.startsWith('link connected')),
      10_000,
      'second link',
    );
    expect(launcher.typedCodes).toHaveLength(1);
    expect(second.lines.join('\n')).not.toContain('minted an invite');
    // The agent's own pairing is expected after a restart: not the warning form.
    expect(second.lines.join('\n')).not.toContain('warning: headless agent');
    expect(second.lines.join('\n')).toContain('active pairing from its own origin');
    const s = openStore(state.db);
    try {
      expect(s.listActivePairings().filter((p) => p.userId === U)).toHaveLength(1);
    } finally {
      s.close();
    }
  });
});

describe('stopping', () => {
  it('app.stop() closes the browser within 5 s and keeps the profile', async () => {
    const t = await boot({ serverMode: true });
    await until(() => t.launcher.launches.length > 0, 10_000, 'launch');
    const started = Date.now();
    await t.app.stop();
    apps.splice(apps.indexOf(t.app), 1);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(t.launcher.closes).toBe(1);
    const { existsSync } = await import('node:fs');
    expect(existsSync(profileDir(t.state.dir, W, U))).toBe(true);
  });
});
