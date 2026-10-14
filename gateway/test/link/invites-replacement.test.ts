import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpServer } from '../../src/http/index.js';
import { createInvite } from '../../src/link/invites.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { OAuthServer } from '../../src/oauth/index.js';
import { PUBLIC } from '../oauth/helpers.js';
import {
  grantVia,
  mcpWith,
  openConsent,
  postConsent,
  type ConsentRig,
} from '../oauth/consent/rig.js';
import { fixtureTool } from '../routing/harness.js';
import { TestClient, hello, startServer } from './helpers.js';

const OLD_ORIGIN = 'http://localhost:30000';
const NEW_ORIGIN = 'https://other.example';

let r: ConsentRig | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await r?.http.close();
  await r?.h.server.close();
  r?.h.store.close();
  r = undefined;
});

/** A public gateway in server mode with the real consent page. */
async function serverRig(): Promise<ConsentRig> {
  const h = await startServer({ serverMode: true, allowedOrigins: undefined });
  const clock = { t: Date.now() };
  const oauth = new OAuthServer({ repo: h.store.oauth, publicUrl: PUBLIC, now: () => clock.t });
  const http = new HttpServer({
    host: '127.0.0.1',
    port: 0,
    publicUrl: PUBLIC,
    oauth,
    registry: h.registry,
    version: '9.9.9',
    startedAt: Date.now(),
    createSession: ({ principal }) =>
      createSessionServer({
        version: '0.0.0',
        registry: h.registry,
        selector: {
          world: principal.selector!.worldId,
          user: principal.selector!.userId,
          exactId: true,
        },
        tools: [fixtureTool],
        callTimeoutMs: 5000,
      }),
    maxRequestBytes: 100_000,
    rps: 1000,
    maxSessions: 16,
    idleMs: 60_000,
    now: () => clock.t,
  });
  const port = await http.listen();
  return { h, http, oauth, port, clock };
}

async function pairByInvite(
  rig: ConsentRig,
  userId: string,
  origin: string,
): Promise<{ tc: TestClient; token: string }> {
  const { code } = createInvite(rig.h.store, { worldId: 'w1', userId }, Date.now());
  const tc = await TestClient.connect(rig.h.port, origin);
  clients.push(tc);
  tc.send(hello({ kind: 'pairingCode', code }, { userId }));
  const w = await tc.next();
  if (w.type !== 'welcome' || !w.pairingToken) throw new Error(`not paired: ${JSON.stringify(w)}`);
  return { tc, token: w.pairingToken };
}

const grants = (rig: ConsentRig): number => {
  const db = new DatabaseSync(rig.h.dbPath, { readOnly: true });
  const n = (db.prepare('SELECT count(*) AS n FROM oauth_grants').get() as { n: number }).n;
  db.close();
  return n;
};
const codeOf = async (m: { tc: TestClient }) =>
  ((await m.tc.next('consentCode')) as unknown as { code: string }).code;

describe('replacing a pairing with a new invite', () => {
  it('revokes the old row, closes the old connection, the old token and its grants', async () => {
    r = await serverRig();
    const old = await pairByInvite(r, 'u1', OLD_ORIGIN);
    const { access } = await grantVia(r, old, 'u1');
    expect((await mcpWith(r, access)).status).not.toBe(401);
    const oldRow = r.h.store.listActivePairings()[0]!;

    const fresh = await pairByInvite(r, 'u1', NEW_ORIGIN);
    await old.tc.untilClosed();
    expect(fresh.token).not.toBe(old.token);
    expect(r.h.store.getPairing(oldRow.id)?.revokedAt).not.toBeNull();
    expect(r.h.store.listActivePairings()).toHaveLength(1);
    expect(r.h.store.listActivePairings()[0]).toMatchObject({ origin: NEW_ORIGIN });

    const again = await TestClient.connect(r.h.port, OLD_ORIGIN);
    clients.push(again);
    again.send(hello({ kind: 'pairingToken', token: old.token }));
    expect(await again.next()).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
    expect((await mcpWith(r, access)).status).toBe(401);
  });

  it('notifies the in-memory listeners with the replaced row after the commit', async () => {
    r = await serverRig();
    const old = await pairByInvite(r, 'u1', OLD_ORIGIN);
    const seen: string[] = [];
    r.h.store.onPairingRevoked((p) => void seen.push(`${p.userId}:${p.origin}`));
    await pairByInvite(r, 'u1', NEW_ORIGIN);
    expect(seen).toEqual([`u1:${OLD_ORIGIN}`]);
    old.tc.ws.terminate();
  });

  it('voids a consent code delivered over the old connection; a new code works', async () => {
    r = await serverRig();
    const old = await pairByInvite(r, 'u1', OLD_ORIGIN);
    const page = await openConsent(r);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const oldCode = await codeOf(old);

    const fresh = await pairByInvite(r, 'u1', NEW_ORIGIN);
    const refused = await postConsent(r, page, { action: 'verify', code: oldCode });
    expect(refused.status).toBe(400);
    expect(refused.headers.location).toBeUndefined();
    expect(grants(r)).toBe(0);

    const page2 = await openConsent(r);
    await postConsent(r, page2, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const newCode = await codeOf(fresh);
    const ok = await postConsent(r, page2, { action: 'verify', code: newCode });
    expect(ok.status).toBe(302);
    expect(grants(r)).toBe(1);
  });

  it('voids a consent code after the pairing is revoked', async () => {
    r = await serverRig();
    const m = await pairByInvite(r, 'u1', OLD_ORIGIN);
    const page = await openConsent(r);
    await postConsent(r, page, { action: 'send', world: 'w1', user: 'u1', scope: 'read' });
    const code = await codeOf(m);
    r.h.store.revokePairingsFor('w1', 'u1');
    const res = await postConsent(r, page, { action: 'verify', code });
    expect(res.status).toBe(400);
    expect(grants(r)).toBe(0);
  });
});

describe('a grant-revocation failure during a replacement', () => {
  it('refuses with INTERNAL, keeps the old pairing and leaves the invite unused', async () => {
    r = await serverRig();
    const old = await pairByInvite(r, 'u1', OLD_ORIGIN);
    const { code } = createInvite(r.h.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    r.h.store.oauth.createClient({
      id: 'c',
      secretHash: null,
      name: 'n',
      redirectUris: ['https://c.example/cb'],
      createdAt: 1,
    });
    r.h.store.oauth.createGrant({
      id: 'g1',
      clientId: 'c',
      worldId: 'w1',
      userId: 'u1',
      scopes: ['read'],
      createdAt: 1,
    });
    const raw = new DatabaseSync(r.h.dbPath);
    raw.exec('PRAGMA busy_timeout = 5000');
    raw.exec('DROP TABLE oauth_tokens');
    raw.close();
    const tc = await TestClient.connect(r.h.port, NEW_ORIGIN);
    clients.push(tc);
    tc.send(hello({ kind: 'pairingCode', code }, { userId: 'u1' }));
    expect(await tc.next()).toMatchObject({ type: 'reject', code: 'INTERNAL' });
    expect(r.h.store.listActivePairings()).toHaveLength(1);
    expect(r.h.store.listActivePairings()[0]).toMatchObject({ origin: OLD_ORIGIN });
    const unused = r.h.store.invites.list().filter((i) => i.usedAt === null);
    expect(unused).toHaveLength(1);
    expect(old.tc.closed).toBe(false);
  });
});
