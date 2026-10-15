import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, type App } from '../../src/app.js';
import { headlessFingerprint, makeRelayConfig } from '../../src/relay/index.js';
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
) {
  const launcher = new FakeLauncher({
    ids: { worldId: W, userId: U, origin: ORIGIN, linkPort: () => shared.linkPort },
  });
  const config = {
    linkPort: shared.linkPort,
    httpPort,
    logLevel: 'error',
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
