import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../../src/app.js';
import { runHeadlessCommand } from '../../../src/headless/config/commands.js';
import { hashToken } from '../../../src/link/server.js';
import { openStore } from '../../../src/store/index.js';
import { ORIGIN, TestClient, hello } from '../../link/helpers.js';
import { freePort, tempState, until } from '../../relay/harness.js';
import { MultiLauncher, W, startGateway } from './harness.js';

const SWEEP = 100;
const U = 'ua1';

const apps: App[] = [];
const clients: TestClient[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  for (const a of apps.splice(0)) await a.stop();
  for (const c of cleanups.splice(0)) c();
});

describe('headless add revokes a stale browser classification', () => {
  it('closes the live browser connection and revokes its pairing within a sweep', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const linkPort = await freePort();
    const multi = new MultiLauncher(state.dir, () => linkPort);
    // The gateway holds the password for a1 but no row yet; once `add` stores it, its runner
    // starts. The fake page types the invite but never sends it, so the test can redeem it.
    multi.forUser(U).noPair = true;
    const g = await startGateway({
      state,
      linkPort,
      agents: [{ name: 'a1', userId: U, password: 'p1' }],
      multi,
      sweepMs: SWEEP,
    });
    apps.push(g.app);

    // A human browser is paired and connected as (w1, ua1) before it is an agent.
    const s = openStore(state.db);
    s.createPairing({
      id: 'p-human',
      tokenHash: hashToken('tok'),
      worldId: W,
      userId: U,
      origin: ORIGIN,
    });
    s.close();
    const c = await TestClient.connect(linkPort, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingToken', token: 'tok' }, { worldId: W, userId: U }));
    expect(await c.next()).toMatchObject({ type: 'welcome' });

    const err: string[] = [];
    const code = runHeadlessCommand({
      argv: ['add', 'a1'],
      values: { 'foundry-url': ORIGIN, world: W, user: U, owner: 'owner1' },
      dbPath: state.db,
      schemaProblem: () => undefined,
      flagAgent: () => undefined,
      out: () => undefined,
      err: (l) => void err.push(l),
    });
    expect({ code, err }).toEqual({ code: 0, err: [] });

    await Promise.race([
      c.untilClosed(),
      until(() => c.closed, SWEEP + 1_000, 'connection closed within a sweep'),
    ]);
    const r = openStore(state.db);
    expect(r.listActivePairings().filter((p) => p.userId === U)).toEqual([]);
    expect(r.headless.getByIdentity(W, U)?.ownerUserId).toBe('owner1');
    r.close();

    // The old token no longer works; the user is a headless agent, reached only by the runner.
    const again = await TestClient.connect(linkPort, ORIGIN);
    clients.push(again);
    again.send(hello({ kind: 'pairingToken', token: 'tok' }, { worldId: W, userId: U }));
    expect(await again.next()).toMatchObject({ code: 'PAIRING_INVALID' });

    // The next connection for (w, u) is classified headless with the stored owner.
    const fake = multi.forUser(U);
    await until(() => fake.typedCodes.length > 0, 10_000, 'runner typed an invite');
    const agent = await TestClient.connect(linkPort, ORIGIN);
    clients.push(agent);
    agent.send(
      hello({ kind: 'pairingCode', code: fake.typedCodes[0]! }, { worldId: W, userId: U }),
    );
    expect(await agent.next()).toMatchObject({
      type: 'welcome',
      headless: true,
      ownerUserId: 'owner1',
    });
  }, 30_000);
});
