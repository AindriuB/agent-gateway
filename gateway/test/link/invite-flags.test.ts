import { afterEach, describe, expect, it } from 'vitest';
import type { LinkMessage } from '@agent-gateway/protocol';
import { createInvite, hashInviteCode } from '../../src/link/invites.js';
import { hashToken } from '../../src/link/index.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from './helpers.js';

let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const boot = async (): Promise<Harness> => (h = await startServer({ serverMode: true }));

async function redeem(
  code: string,
  who: { worldId?: string; userId?: string; isGM?: boolean; protocolVersion?: string } = {},
): Promise<{ c: TestClient; first: LinkMessage }> {
  const c = await TestClient.connect(h!.port, ORIGIN);
  clients.push(c);
  c.send(hello({ kind: 'pairingCode', code }, who));
  return { c, first: await c.next() };
}

const row = (code: string) => h!.store.invites.findByHash(hashInviteCode(code))!;

describe('protocol 7', () => {
  it('refuses a 6.0.0 hello with PROTOCOL_MAJOR_MISMATCH and leaves the invite unused', async () => {
    await boot();
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1', gm: true }, Date.now());
    const { first } = await redeem(inv.code, { protocolVersion: '6.0.0' });
    expect(first).toMatchObject({ type: 'reject', code: 'PROTOCOL_MAJOR_MISMATCH' });
    expect(row(inv.code).usedAt).toBeNull();
  });
});

describe('the vouch is skipped only by an invite flag', () => {
  it.each([true, false])(
    'a gm invite pairs directly with hello.isGM %s, admin 0, no challenge and no admin live',
    async (isGM) => {
      await boot();
      const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1', gm: true }, Date.now());
      const { c, first } = await redeem(inv.code, { isGM });
      expect(first).toMatchObject({ type: 'welcome', admin: false });
      expect(c.messages.some((m) => m.type === 'pairingChallenge')).toBe(false);
      const token = (first as { pairingToken: string }).pairingToken;
      expect(h!.store.findPairingByHash(hashToken(token))).toMatchObject({
        userId: 'u1',
        admin: false,
      });
      expect(row(inv.code)).toMatchObject({ result: 'paired' });
    },
  );

  it('a plain invite whose hello says isGM true still gets a challenge with an admin live', async () => {
    await boot();
    const adminInv = createInvite(
      h!.store,
      { worldId: 'w1', userId: 'gm1', admin: true },
      Date.now(),
    );
    await redeem(adminInv.code, { userId: 'gm1' });
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    const { first } = await redeem(inv.code, { isGM: true });
    expect(first).toMatchObject({ type: 'pairingChallenge' });
    expect(row(inv.code).usedAt).toBeNull();
  });

  it('a plain invite whose hello says isGM true is PAIRING_UNCONFIRMED with none live, and unused', async () => {
    await boot();
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    const { first } = await redeem(inv.code, { isGM: true });
    expect(first).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
    expect(row(inv.code).usedAt).toBeNull();
    expect(h!.store.listPairings()).toEqual([]);
  });

  it.each([{ userId: 'other' }, { worldId: 'w2' }])(
    'a gm invite whose claim does not match (%j) is settled as mismatch, like a plain one',
    async (who) => {
      await boot();
      const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1', gm: true }, Date.now());
      const { first } = await redeem(inv.code, who);
      expect(first).toMatchObject({ type: 'reject', code: 'PAIRING_INVALID' });
      expect(row(inv.code)).toMatchObject({ result: 'mismatch', pairingId: null });
      expect(h!.store.listPairings()).toEqual([]);
    },
  );
});

describe('admin invites', () => {
  it('redeem directly into an admin pairing; welcome.admin follows the row on every reconnect', async () => {
    await boot();
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'gm1', admin: true }, Date.now());
    const { first } = await redeem(inv.code, { userId: 'gm1', isGM: false });
    expect(first).toMatchObject({ type: 'welcome', admin: true });
    const token = (first as { pairingToken: string }).pairingToken;
    const pairing = h!.store.findPairingByHash(hashToken(token))!;
    expect(pairing.admin).toBe(true);

    const reconnect = async (): Promise<LinkMessage> => {
      const c = await TestClient.connect(h!.port, ORIGIN);
      clients.push(c);
      c.send(hello({ kind: 'pairingToken', token }, { userId: 'gm1' }));
      return c.next();
    };
    expect(await reconnect()).toMatchObject({ type: 'welcome', admin: true });
    expect(h!.store.demotePairing(pairing.id)).toBe(true);
    expect(await reconnect()).toMatchObject({ type: 'welcome', admin: false });
  });

  it('a token reconnect with hello.isGM true never makes a non-admin pairing admin', async () => {
    await boot();
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1', gm: true }, Date.now());
    const { first } = await redeem(inv.code, { isGM: true });
    const token = (first as { pairingToken: string }).pairingToken;
    const c = await TestClient.connect(h!.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingToken', token }, { isGM: true }));
    expect(await c.next()).toMatchObject({ type: 'welcome', admin: false });
  });
});

describe('local mode', () => {
  it('a shared-code pairing is unchanged: no admin field, and the pairing is not admin', async () => {
    h = await startServer();
    const c = await TestClient.connect(h.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: h.codes.issue('startup').code }, { isGM: true }));
    const w = await c.next();
    expect(w).toMatchObject({ type: 'welcome' });
    expect(w).not.toHaveProperty('admin');
    expect(h.store.listActivePairings()[0]?.admin).toBe(false);
  });
});

describe('createInvite', () => {
  it.each([{ admin: true }, { gm: true }])(
    'throws and writes nothing when createdBy is set with %j',
    async (flags) => {
      await boot();
      expect(() =>
        createInvite(h!.store, { worldId: 'w1', userId: 'u1', createdBy: 'p1', ...flags }, 1),
      ).toThrow(/only the operator/);
      expect(h!.store.invites.list()).toEqual([]);
    },
  );

  it('defaults to a plain operator invite', async () => {
    await boot();
    const inv = createInvite(h!.store, { worldId: 'w1', userId: 'u1' }, 1);
    expect(row(inv.code)).toMatchObject({ admin: false, gm: false, createdBy: null });
  });
});
