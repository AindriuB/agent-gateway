import { chmodSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import {
  headlessFingerprint,
  makeRelayConfig,
  RelayServer,
  relayEndpoint,
  RelaySecondary,
  sameConfig,
  type RelayConfig,
} from '../../src/relay/index.js';
import { ORIGIN } from '../link/helpers.js';
import { freePort, sleep, tempState, until } from '../relay/harness.js';
import { FakeLauncher } from './fake-browser.js';

const W = 'w1';
const U = 'agentuser0000001';
type Config = Parameters<typeof createApp>[0];

const apps: App[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

/** A gateway on a shared link port and db; `password` undefined means no headless flags. */
function gateway(
  shared: { linkPort: number; db: string },
  httpPort: number,
  password: string | undefined,
  lines: string[],
  over: { logLevel?: string; allowedOrigins?: string[]; logs?: string[] } = {},
) {
  const launcher = new FakeLauncher({
    ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => shared.linkPort },
  });
  const config = {
    linkPort: shared.linkPort,
    httpPort,
    logLevel: over.logLevel ?? 'error',
    ...(password === undefined
      ? {}
      : {
          headlessFoundryUrl: ORIGIN,
          headlessWorld: W,
          headlessUser: U,
          headlessPassword: password,
        }),
  } as unknown as Config;
  const app = createApp(config, {
    version: '0.0.0-test',
    dbPath: shared.db,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    writeStatus: (l) => void lines.push(l),
    ...(over.allowedOrigins ? { allowedOrigins: over.allowedOrigins } : {}),
    ...(over.logs
      ? {
          logger: {
            debug: () => undefined,
            info: (m: string) => void over.logs!.push(m),
            warn: (m: string) => void over.logs!.push(m),
            error: (m: string) => void over.logs!.push(m),
          },
        }
      : {}),
    selector: { world: W, user: U },
    ...(password === undefined
      ? {}
      : {
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
        }),
  });
  apps.push(app);
  return { app, launcher };
}

async function setup() {
  const state = tempState();
  cleanups.push(state.cleanup);
  return { linkPort: await freePort(), db: state.db };
}

describe('headless settings in the takeover comparison', () => {
  it('a newer gateway with headless settings takes over from one without', async () => {
    const shared = await setup();
    const aLines: string[] = [];
    const httpPort = await freePort();
    const a = gateway(shared, httpPort, undefined, aLines);
    await a.app.start();
    await sleep(10);
    const b = gateway(shared, httpPort, 'hunter2', []);
    await b.app.start();
    await until(() => b.launcher.launches.length > 0, 15_000, 'B starts its agent');
    // The primary names the headless difference in both texts: the refusal log (server.ts refuse
    // site) and the step-down reason; each passes mineIsCaller=false.
    expect(aLines.some((l) => /^relay refused: .*headless agent settings differ/.test(l))).toBe(
      true,
    );
    await until(
      () => aLines.some((l) => /^stepping down: .*headless agent settings differ/.test(l)),
      10_000,
      'A reports why it stepped down',
    );
  }, 30_000);

  it('a newer gateway with identical headless settings still relays', async () => {
    const shared = await setup();
    const httpPort = await freePort();
    const a = gateway(shared, httpPort, 'hunter2', []);
    await a.app.start();
    await until(() => a.launcher.launches.length > 0, 15_000, 'A starts its agent');
    await sleep(10);
    const b = gateway(shared, httpPort, 'hunter2', []);
    await b.app.start();
    await sleep(1_500);
    expect(b.launcher.launches).toHaveLength(0);
    expect(a.launcher.launches).toHaveLength(1);
  }, 30_000);

  it('a changed password alone triggers takeover', async () => {
    const shared = await setup();
    const httpPort = await freePort();
    const a = gateway(shared, httpPort, 'hunter2', []);
    await a.app.start();
    await until(() => a.launcher.launches.length > 0, 15_000, 'A starts its agent');
    await sleep(10);
    const b = gateway(shared, httpPort, 'hunter3', []);
    await b.app.start();
    await until(() => b.launcher.launches.length > 0, 15_000, 'B starts its agent');
  }, 30_000);
});

describe('headless wins on takeover', () => {
  it('a newer gateway without headless settings relays and the runner keeps running', async () => {
    const shared = await setup();
    const httpPort = await freePort();
    const a = gateway(shared, httpPort, 'hunter2', []);
    await a.app.start();
    await until(() => a.launcher.launches.length > 0, 15_000, 'A starts its agent');
    await sleep(10);
    const bLines: string[] = [];
    const b = gateway(shared, httpPort, undefined, bLines);
    await b.app.start();
    await sleep(1_500);
    expect(a.launcher.launches).toHaveLength(1);
    expect(a.launcher.closes).toBe(0);
    expect(b.launcher.launches).toHaveLength(0);
  }, 30_000);

  it.each([
    ['logLevel', { logLevel: 'debug' }, false],
    ['httpPort', {}, true],
  ])(
    'a newer plain gateway differing only in %s is relayed and the runner keeps running',
    async (_name, over, otherPort) => {
      const shared = await setup();
      const httpPort = await freePort();
      const aLogs: string[] = [];
      const a = gateway(shared, httpPort, 'hunter2', aLogs);
      await a.app.start();
      await until(() => a.launcher.launches.length > 0, 15_000, 'A starts its agent');
      await sleep(10);
      const logs: string[] = [];
      const b = gateway(shared, otherPort ? await freePort() : httpPort, undefined, [], {
        ...over,
        logs,
      });
      await b.app.start();
      await until(() => logs.some((l) => l.includes('relays to it')), 15_000, 'B relays');
      expect(logs.join('\n')).not.toContain('standby');
      // The primary served a session-neutral difference; it must not call the plain caller's
      // missing headless settings a difference (mineIsCaller is false on its side).
      await until(
        () => aLogs.some((l) => l.includes('session-neutral difference')),
        5_000,
        'A logs the neutral difference',
      );
      expect(aLogs.join('\n')).not.toContain('headless agent settings differ');
      await sleep(500);
      expect(a.launcher.launches).toHaveLength(1);
      expect(a.launcher.closes).toBe(0);
      expect(b.launcher.launches).toHaveLength(0);
    },
    30_000,
  );

  it('a newer plain gateway differing in allowed origins is a standby and the runner keeps running', async () => {
    const shared = await setup();
    const httpPort = await freePort();
    const a = gateway(shared, httpPort, 'hunter2', []);
    await a.app.start();
    await until(() => a.launcher.launches.length > 0, 15_000, 'A starts its agent');
    await sleep(10);
    const logs: string[] = [];
    const b = gateway(shared, httpPort, undefined, [], {
      allowedOrigins: ['https://other.example.com'],
      logs,
    });
    await b.app.start();
    await until(() => logs.some((l) => l.includes('is a standby')), 15_000, 'B standby');
    expect(logs.join('\n')).toContain('different session settings');
    expect(logs.join('\n')).toContain('kept because it runs a headless agent');
    expect(logs.join('\n')).not.toContain('not older');
    expect(logs.join('\n')).not.toContain('headless agent settings differ');
    await sleep(500);
    expect(a.launcher.launches).toHaveLength(1);
    expect(a.launcher.closes).toBe(0);
    expect(b.launcher.launches).toHaveLength(0);
  }, 30_000);

  it('an older caller without headless settings is served by a headless primary', () => {
    const fp = headlessFingerprint(
      { foundryUrl: ORIGIN, worldId: W, userId: U, password: 'p' },
      false,
    );
    const primary = makeRelayConfig([], 1, 'info', 200, { headless: fp });
    const olderPlain = makeRelayConfig([], 1, 'info', 100);
    expect(sameConfig(olderPlain, primary)).toBe(true);
    // The other direction is not symmetric: a headless caller against a plain primary differs.
    expect(sameConfig(primary, olderPlain)).toBe(false);
    const other = makeRelayConfig([], 1, 'info', 100, { headless: 'f'.repeat(64) });
    expect(sameConfig(other, primary)).toBe(false);
  });
});

describe('the comparison value', () => {
  const agent = { foundryUrl: 'http://foundry.local:30000/x', worldId: W, userId: U };
  it('is empty without an agent and differs per setting', () => {
    expect(headlessFingerprint(undefined, false)).toBe('');
    const base = headlessFingerprint({ ...agent, password: 'p' }, false);
    for (const other of [
      headlessFingerprint({ ...agent, password: 'q' }, false),
      headlessFingerprint({ ...agent, password: 'p' }, true),
      headlessFingerprint({ ...agent, userId: 'other', password: 'p' }, false),
      headlessFingerprint({ ...agent, worldId: 'w2', password: 'p' }, false),
      headlessFingerprint(
        { ...agent, foundryUrl: 'http://foundry.local:30000/y', password: 'p' },
        false,
      ),
    ])
      expect(other).not.toBe(base);
    expect(headlessFingerprint({ ...agent, password: 'p' }, false)).toBe(base);
  });

  it('carries neither the password nor the URL', () => {
    const fp = headlessFingerprint({ ...agent, password: 'hunter2-secret' }, false);
    const wire = JSON.stringify(makeRelayConfig([], 1, 'info', 1, { headless: fp }));
    expect(wire).not.toContain('hunter2');
    expect(wire).not.toContain('foundry.local');
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('the standby reason after a RELAY_CONFIG_MISMATCH', () => {
  const rigs: { dir: string; server: RelayServer; cleanup: () => void }[] = [];
  const secs: RelaySecondary[] = [];
  afterEach(async () => {
    for (const x of secs.splice(0)) await x.stop();
    for (const r of rigs.splice(0)) {
      await r.server.close();
      r.cleanup();
    }
  });

  /** A primary with `primary` config and a caller with `caller`; resolves to the standby reason. */
  async function reasonFor(primary: RelayConfig, caller: RelayConfig): Promise<string> {
    const port = 7791;
    const state = tempState();
    chmodSync(state.dir, 0o700);
    const ep = relayEndpoint(state.dir, port);
    if (!ep.ok) throw new Error(ep.reason);
    const server = new RelayServer({
      endpoint: ep.path,
      stateDir: state.dir,
      linkPort: port,
      config: primary,
      selector: {},
      createSession: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      log: () => undefined,
    });
    await server.listen();
    rigs.push({ dir: state.dir, server, cleanup: state.cleanup });
    let reason = '';
    const sec = new RelaySecondary({
      endpoint: ep.path,
      stateDir: state.dir,
      linkPort: port,
      selector: {},
      config: caller,
      input: new PassThrough(),
      output: new PassThrough(),
      log: () => undefined,
      becomePrimary: () => Promise.resolve(false),
      createDegraded: () => new Server({ name: 't', version: '0' }, { capabilities: {} }),
      createStandby: (why) => {
        reason = why;
        return new Server({ name: 't', version: '0' }, { capabilities: {} });
      },
      sleep: () => sleep(10),
    });
    secs.push(sec);
    await sec.start('test');
    return reason;
  }

  const fp = headlessFingerprint(
    { foundryUrl: ORIGIN, worldId: W, userId: U, password: 'p' },
    false,
  );
  const origins = ['https://other.example.com'];

  it('says a headless primary is kept for its agent, not that it is not older', async () => {
    const reason = await reasonFor(
      makeRelayConfig([], 1, 'info', 1000, { headless: fp }),
      makeRelayConfig(origins, 1, 'info', 2000),
    );
    expect(reason).toContain('kept because it runs a headless agent');
    expect(reason).toContain('allowed origins');
    expect(reason).not.toContain('not older');
  }, 20_000);

  it('keeps the old wording for a plain primary that is not older', async () => {
    const reason = await reasonFor(
      makeRelayConfig([], 1, 'info', 2000),
      makeRelayConfig(origins, 1, 'info', 1000),
    );
    expect(reason).toContain('is not older than this instance, so it is left running');
  }, 20_000);
});
