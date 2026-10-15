import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../../src/app.js';
import { ORIGIN, TestClient, hello } from '../../link/helpers.js';
import { freePort, sleep, tempState, until } from '../../relay/harness.js';
import { MultiLauncher, W, seedAgents, startGateway } from './harness.js';

const apps: App[] = [];
const clients: TestClient[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

async function env() {
  const state = tempState();
  cleanups.push(state.cleanup);
  const linkPort = await freePort();
  const multi = new MultiLauncher(state.dir, () => linkPort);
  return { state, linkPort, multi };
}

describe('several stored agents', () => {
  it('starts one runner per agent with a password, on separate profiles, with one discovery', async () => {
    const { state, linkPort, multi } = await env();
    const agents = [
      { name: 'a1', userId: 'ua1', password: 'p1' },
      { name: 'a2', userId: 'ua2', password: 'p2' },
      { name: 'a3', userId: 'ua3' },
    ];
    multi.forUser('ua1');
    multi.forUser('ua2');
    seedAgents(state.db, agents, 'owner1');
    let discoveries = 0;
    let launcherBuilds = 0;
    const g = await startGateway({
      state,
      linkPort,
      agents,
      multi,
      noSandbox: true,
      sweepMs: 50,
      noLauncher: true,
      discover: () => {
        discoveries++;
        return { kind: 'chrome', path: '/usr/bin/fake-chrome' } as ReturnType<
          NonNullable<Parameters<typeof startGateway>[0]['discover']>
        >;
      },
      launcherFor: (path) => {
        launcherBuilds++;
        expect(path).toBe('/usr/bin/fake-chrome');
        return multi;
      },
    });
    apps.push(g.app);
    await until(() => multi.launches.length === 2, 10_000, 'both launches');
    await until(
      () => g.lines.filter((l) => l.startsWith('link connected')).length === 2,
      10_000,
      'both agents linked',
    );
    // Several sweeps later: still one discovery, one browser line, one line for the missing password.
    await sleep(300);
    expect(discoveries).toBe(1);
    expect(launcherBuilds).toBe(1);
    expect(g.lines.filter((l) => l.startsWith('headless runner browser:'))).toHaveLength(1);
    const dirs = multi.launches.map((l) => l.profileDir);
    expect(new Set(dirs).size).toBe(2);
    for (const d of dirs) {
      expect(d.startsWith(join(state.dir, 'headless', 'profiles') + '/')).toBe(true);
      expect(dirname(dirname(d))).toBe(join(state.dir, 'headless'));
    }
    expect(multi.launches.map((l) => l.noSandbox)).toEqual([true, true]);
    const missing = g.lines.filter((l) => l.includes('headless agent a3'));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('not started');
    expect(multi.launches).toHaveLength(2);
  }, 30_000);

  it('logs one "no browser" line for all agents, not one each', async () => {
    const { state, linkPort, multi } = await env();
    const agents = [
      { name: 'a1', userId: 'ua1', password: 'p1' },
      { name: 'a2', userId: 'ua2', password: 'p2' },
    ];
    seedAgents(state.db, agents);
    const g = await startGateway({
      state,
      linkPort,
      agents,
      multi,
      sweepMs: 50,
      noLauncher: true,
      discover: () => undefined,
    });
    apps.push(g.app);
    await sleep(400);
    expect(g.lines.filter((l) => l.includes('no Chrome, Edge or Chromium found'))).toHaveLength(1);
  });
});

describe('with no flag/env agent and no stored agents', () => {
  it('still runs the provider and classifier, and the shared code pairs a human', async () => {
    const { state, linkPort, multi } = await env();
    const g = await startGateway({ state, linkPort, multi, sweepMs: 50 });
    apps.push(g.app);
    const code = g.lines.map((l) => /Pairing code: (\S+)/.exec(l)?.[1]).find(Boolean)!;
    const c = await TestClient.connect(linkPort, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code }, { worldId: W, userId: 'u-human' }));
    expect(await c.next()).toMatchObject({ type: 'welcome' });
    // A claim to be headless is ignored: nothing is configured.
    const d = await TestClient.connect(linkPort, ORIGIN);
    clients.push(d);
    d.send({
      ...hello({ kind: 'pairingCode', code: 'AAAA-AAAA-AAAA' }, { worldId: W, userId: 'u2' }),
      headless: true,
    });
    expect(await d.next()).toMatchObject({ code: 'PAIRING_INVALID' });
  });

  it('an agent stored after start is classified headless without a restart', async () => {
    const { state, linkPort, multi } = await env();
    const g = await startGateway({ state, linkPort, multi, sweepMs: 50 });
    apps.push(g.app);
    seedAgents(state.db, [{ name: 'a1', userId: 'ua1' }]);
    const code = g.lines.map((l) => /Pairing code: (\S+)/.exec(l)?.[1]).find(Boolean)!;
    const c = await TestClient.connect(linkPort, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code }, { worldId: W, userId: 'ua1' }));
    expect(await c.next()).toMatchObject({ code: 'PAIRING_INVALID' });
  });
});
