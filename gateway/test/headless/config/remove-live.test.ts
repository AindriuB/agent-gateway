import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../../src/app.js';
import { runHeadlessCommand } from '../../../src/headless/config/commands.js';
import { profileDir } from '../../../src/headless/profile.js';
import { openStore } from '../../../src/store/index.js';
import { ORIGIN, TestClient, hello } from '../../link/helpers.js';
import { freePort, sleep, tempState, until } from '../../relay/harness.js';
import { MultiLauncher, W, seedAgents, startGateway } from './harness.js';

const SWEEP = 100;
const U = 'ua1';
const agent = { name: 'a1', userId: U, password: 'p1' };

const apps: App[] = [];
const clients: TestClient[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

async function boot() {
  const state = tempState();
  cleanups.push(state.cleanup);
  const linkPort = await freePort();
  const multi = new MultiLauncher(state.dir, () => linkPort);
  const fake = multi.forUser(U);
  seedAgents(state.db, [agent], 'owner1');
  const g = await startGateway({ state, linkPort, agents: [agent], multi, sweepMs: SWEEP });
  apps.push(g.app);
  const linked = () => g.lines.filter((l) => l.startsWith('link connected')).length;
  /** `headless remove` / `add` in "another process": its own connection to the same file. */
  const cli = (argv: string[], values = {}) => {
    const err: string[] = [];
    const code = runHeadlessCommand({
      argv,
      values,
      dbPath: state.db,
      schemaProblem: () => undefined,
      flagAgent: () => undefined,
      out: () => undefined,
      err: (l) => void err.push(l),
    });
    expect({ code, err }).toEqual({ code: 0, err: [] });
  };
  const readd = () =>
    cli(['add', 'a1'], { 'foundry-url': ORIGIN, world: W, user: U, owner: 'owner1' });
  return { state, linkPort, multi, fake, g, linked, cli, readd };
}

describe('headless remove reaches a running gateway', () => {
  it('stops the runner and the link within a sweep, keeps the profile, and re-add starts a fresh runner', async () => {
    const t = await boot();
    await until(() => t.linked() === 1, 10_000, 'agent linked');
    expect(t.fake.typedCodes).toHaveLength(1);
    const dir = profileDir(t.state.dir, W, U);

    t.cli(['remove', 'a1']);
    const began = Date.now();
    await until(() => t.fake.closes === 1, SWEEP + 1_000, 'runner stopped');
    expect(Date.now() - began).toBeLessThan(SWEEP + 1_000);
    await until(
      () => t.g.lines.some((l) => l.startsWith('link disconnected')),
      SWEEP + 1_000,
      'link closed',
    );
    const { existsSync } = await import('node:fs');
    expect(existsSync(dir)).toBe(true);

    // Nothing restarts while the row is gone.
    await sleep(3 * SWEEP);
    expect(t.multi.launches).toHaveLength(1);
    expect(t.fake.typedCodes).toHaveLength(1);

    t.readd();
    await until(() => t.multi.launches.length === 2, SWEEP + 1_000, 'fresh runner');
    expect(t.multi.launches[1]!.profileDir).toBe(dir);
    await until(() => t.linked() === 2, 10_000, 'agent linked again');
    // The old pairing was revoked, so the fresh runner paired through a newly minted invite.
    expect(t.fake.typedCodes.length).toBeGreaterThanOrEqual(2);
    const s = openStore(t.state.db);
    expect(s.listActivePairings().filter((p) => p.userId === U)).toHaveLength(1);
    s.close();
  }, 30_000);

  it('an invite outstanding at remove time cannot pair afterwards', async () => {
    const t = await boot();
    t.fake.noPair = true;
    await until(() => t.fake.typedCodes.length === 1, 10_000, 'invite typed');
    const code = t.fake.typedCodes[0]!;
    t.cli(['remove', 'a1']);
    await until(() => t.fake.closes === 1, SWEEP + 1_000, 'runner stopped');

    const c = await TestClient.connect(t.linkPort, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code }, { worldId: W, userId: U }));
    expect(await c.next()).toMatchObject({ code: 'PAIRING_INVALID' });
    const s = openStore(t.state.db);
    expect(s.listPairings()).toEqual([]);
    s.close();

    // Pairing stays refused (no invite can exist) until the agent is added again.
    const again = await TestClient.connect(t.linkPort, ORIGIN);
    clients.push(again);
    again.send(hello({ kind: 'pairingCode', code }, { worldId: W, userId: U }));
    expect(await again.next()).toMatchObject({ code: 'PAIRING_INVALID' });
    expect(t.fake.typedCodes).toHaveLength(1);
  }, 30_000);

  it('a row removed and added back between two sweeps leaves the runner alone', async () => {
    const t = await boot();
    await until(() => t.linked() === 1, 10_000, 'agent linked');
    // Same identity, same URL, same password: nothing to reconcile.
    const s = openStore(t.state.db);
    s.transaction(() => {
      s.headless.remove('a1');
      s.headless.add({
        name: 'a1',
        foundryUrl: ORIGIN,
        worldId: W,
        userId: U,
        ownerUserId: null,
      });
    });
    s.close();
    await sleep(4 * SWEEP);
    expect(t.fake.closes).toBe(0);
    expect(t.multi.launches).toHaveLength(1);
  }, 30_000);
});

describe('re-pairing after a lost token', () => {
  it('a fresh minted invite replaces the old pairing', async () => {
    const t = await boot();
    await until(() => t.linked() === 1, 10_000, 'agent linked');
    await t.g.app.stop();
    apps.splice(apps.indexOf(t.g.app), 1);
    // A new profile has no token: the runner must pair again.
    const multi = new MultiLauncher(t.state.dir, () => t.linkPort);
    const fake = multi.forUser(U);
    const g = await startGateway({
      state: t.state,
      linkPort: t.linkPort,
      agents: [agent],
      multi,
      sweepMs: SWEEP,
    });
    apps.push(g.app);
    await until(
      () => g.lines.some((l) => l.startsWith('link connected')),
      10_000,
      'agent paired again',
    );
    expect(fake.typedCodes).toHaveLength(1);
    const s = openStore(t.state.db);
    const rows = s.listPairings().filter((p) => p.userId === U);
    s.close();
    expect(rows).toHaveLength(2);
    expect(rows.filter((p) => p.revokedAt === null)).toHaveLength(1);
  }, 30_000);
});
