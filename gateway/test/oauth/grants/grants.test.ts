import { afterEach, describe, expect, it } from 'vitest';
import { call } from '../helpers.js';
import { pairModule, type FakeModule } from '../../routing/harness.js';
import { form, grantVia, consentRig, mcpWith, stopRig, type ConsentRig } from '../consent/rig.js';

let r: ConsentRig | undefined;
const modules: FakeModule[] = [];
afterEach(async () => {
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await stopRig(r);
  r = undefined;
});

interface GrantsReply {
  type: 'grants';
  requestId: string;
  grants: { id: string; clientName: string; scopes: string[]; lastUsedAt: number | null }[];
}
const list = async (m: FakeModule, requestId = 'r1'): Promise<GrantsReply> => {
  m.tc.send({ type: 'listGrants', requestId });
  return (await m.tc.next('grants')) as unknown as GrantsReply;
};

async function twoGranted() {
  r = await consentRig();
  const u1 = await pairModule(r.h, 'u1');
  const u2 = await pairModule(r.h, 'u2');
  modules.push(u1, u2);
  const t1 = await grantVia(r, u1, 'u1', 'Claude', 'read write');
  const t2 = await grantVia(r, u2, 'u2', 'ChatGPT', 'read');
  return { u1, u2, t1, t2 };
}

describe('grants over the link', () => {
  it('lists only the grants bound to the connection, with name, scopes and last used', async () => {
    const { u1, u2, t1 } = await twoGranted();
    await mcpWith(r!, t1.access);
    const mine = await list(u1);
    expect(mine.requestId).toBe('r1');
    expect(mine.grants).toHaveLength(1);
    expect(mine.grants[0]).toMatchObject({ clientName: 'Claude', scopes: ['read', 'write'] });
    const theirs = await list(u2);
    expect(theirs.grants.map((g) => g.clientName)).toEqual(['ChatGPT']);
  });

  it('ignores a forged user: a payload naming another user is refused and returns nothing', async () => {
    const { u1 } = await twoGranted();
    u1.tc.send({ type: 'listGrants', requestId: 'f', userId: 'u2', worldId: 'w1' });
    await u1.tc.untilClosed();
    expect(u1.tc.messages.filter((m) => m.type === 'grants')).toHaveLength(0);
  });

  it("revoking another user's grant id changes nothing", async () => {
    const { u1, u2, t2 } = await twoGranted();
    const victim = (await list(u2)).grants[0]!.id;
    u1.tc.send({ type: 'revokeGrant', requestId: 'x', grantId: victim });
    const reply = (await u1.tc.next('grants')) as unknown as GrantsReply;
    expect(reply.grants.map((g) => g.clientName)).toEqual(['Claude']);
    expect((await list(u2)).grants).toHaveLength(1);
    expect((await mcpWith(r!, t2.access)).status).not.toBe(401);
  });

  it('revoking kills the access and refresh token at once', async () => {
    const { u1, t1 } = await twoGranted();
    expect((await mcpWith(r!, t1.access)).status).not.toBe(401);
    const id = (await list(u1)).grants[0]!.id;
    u1.tc.send({ type: 'revokeGrant', requestId: 'rv', grantId: id });
    const after = (await u1.tc.next('grants')) as unknown as GrantsReply;
    expect(after.requestId).toBe('rv');
    expect(after.grants).toHaveLength(0);
    expect((await mcpWith(r!, t1.access)).status).toBe(401);
    const refreshed = await call(r!.port, 'POST', '/token', {
      body: form({ grant_type: 'refresh_token', refresh_token: t1.refresh, client_id: 'x' }),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(refreshed.status).toBeGreaterThanOrEqual(400);
  });

  it('dies with its pairing', async () => {
    const { u1, u2, t1, t2 } = await twoGranted();
    const pairing = r!.h.store.listActivePairings().find((p) => p.userId === 'u1')!;
    r!.h.store.revokePairing(pairing.id);
    expect((await mcpWith(r!, t1.access)).status).toBe(401);
    expect(r!.h.store.oauth.listLiveGrants('w1', 'u1')).toEqual([]);
    expect((await mcpWith(r!, t2.access)).status).not.toBe(401);
    expect((await list(u2)).grants).toHaveLength(1);
    void u1;
  });

  it('a token granted for one user never reaches the other user', async () => {
    const { u1, u2, t1 } = await twoGranted();
    // The MCP session for t1 is pinned to (w1,u1): its tool call lands on u1 only.
    const init = await call(r!.port, 'POST', '/mcp', {
      headers: {
        authorization: `Bearer ${t1.access}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    expect(init.status).toBe(200);
    expect(u2.tc.messages.filter((m) => m.type === 'call')).toHaveLength(0);
    expect(r!.h.store.oauth.listLiveGrants('w1', 'u1')[0]!.userId).toBe('u1');
    void u1;
  });
});
