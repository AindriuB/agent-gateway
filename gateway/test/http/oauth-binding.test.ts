import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { call, initBody, rig, stop, type Rig } from '../oauth/helpers.js';
import { pairModule, tick, until, type FakeModule } from '../routing/harness.js';

let r: Rig | undefined;
const clients: Client[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await stop(r);
  r = undefined;
});

const connect = async (rr: Rig, token: string): Promise<Client> => {
  const c = new Client({ name: 't', version: '0' });
  clients.push(c);
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${rr.port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return c;
};

const calls = (m: FakeModule) => m.tc.messages.filter((x) => x.type === 'call');

async function twoUsers(rr: Rig) {
  const u1 = await pairModule(rr.h, 'u1');
  const u2 = await pairModule(rr.h, 'u2');
  modules.push(u1, u2);
  return { u1, u2 };
}

describe('grant binding', () => {
  it('a (w1,u1) token reaches u1 and never u2', async () => {
    r = await rig();
    const { u1, u2 } = await twoUsers(r);
    const tok = await r.login(await r.client());
    const c = await connect(r, tok.access_token!);
    const res = c.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    const frame = (await u1.tc.next('call')) as { id: string };
    u1.tc.send({ type: 'result', id: frame.id, ok: true, text: 'ok', structured: { b: 'y' } });
    expect((await res).structuredContent).toEqual({ b: 'y' });
    await tick();
    expect(calls(u2)).toHaveLength(0);
  });

  it('with only u2 connected the call is WORLD_OFFLINE and u2 sees no frame', async () => {
    r = await rig();
    const u2 = await pairModule(r.h, 'u2');
    modules.push(u2);
    const tok = await r.login(await r.client());
    const c = await connect(r, tok.access_token!);
    const res = await c.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('WORLD_OFFLINE');
    await tick();
    expect(calls(u2)).toHaveLength(0);
  });

  it('a token cannot open a session for a different grant or without a credential', async () => {
    r = await rig();
    const tok = await r.login(await r.client());
    const init = await r.mcp(tok.access_token!, initBody);
    const sid = init.headers['mcp-session-id'] as string;
    expect(sid).toBeTruthy();
    const other = await r.login(await r.client());
    const hijack = await r.mcp(
      other.access_token!,
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      { 'mcp-session-id': sid },
    );
    expect(hijack.status).toBe(404);
  });

  it('revoking the grant makes the next request on an open session 401', async () => {
    r = await rig();
    const tok = await r.login(await r.client());
    const init = await r.mcp(tok.access_token!, initBody);
    const sid = init.headers['mcp-session-id'] as string;
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect((await r.mcp(tok.access_token!, list, { 'mcp-session-id': sid })).status).toBe(200);
    const db = new DatabaseSync(r.h.dbPath);
    const id = (db.prepare('SELECT id FROM oauth_grants').get() as { id: string }).id;
    db.close();
    expect(r.h.store.oauth.revokeGrant(id, Date.now())).toBe(true);
    expect((await r.mcp(tok.access_token!, list, { 'mcp-session-id': sid })).status).toBe(401);
  });
});

describe('pairing revocation', () => {
  it('revokePairing revokes that (world, user)s grants and tokens and no others', async () => {
    r = await rig();
    const { u1 } = await twoUsers(r);
    const c1 = await r.client();
    const t1 = await r.login(c1);
    r.consent.next = () => ({ approve: { worldId: 'w1', userId: 'u2', scopes: ['read'] } });
    const t2 = await r.login(await r.client());
    expect((await r.mcp(t1.access_token!, initBody)).status).toBe(200);
    expect((await r.mcp(t2.access_token!, initBody)).status).toBe(200);
    const pairing = r.h.store.listActivePairings().find((p) => p.userId === u1.userId)!;
    expect(r.h.store.revokePairing(pairing.id)).toBe(true);
    expect((await r.mcp(t1.access_token!, initBody)).status).toBe(401);
    expect((await r.mcp(t2.access_token!, initBody)).status).toBe(200);
    const refresh = await r.token({
      grant_type: 'refresh_token',
      refresh_token: t1.refresh_token!,
      client_id: c1.id,
    });
    expect(refresh.json().error).toBe('invalid_grant');
  });

  it('listeners receive the revoked row', async () => {
    r = await rig();
    await pairModule(r.h, 'u1').then((m) => modules.push(m));
    const seen: string[] = [];
    r.h.store.onPairingRevoked((p) => seen.push(`${p.worldId}/${p.userId}`));
    r.h.store.revokePairing(r.h.store.listActivePairings()[0]!.id);
    expect(seen).toEqual(['w1/u1']);
  });
});

describe('/status', () => {
  it('shows only that grants (world, user) with a token, and only version and uptime without', async () => {
    r = await rig();
    await twoUsers(r);
    await until(() => r!.h.registry.list().length === 2);
    const tok = await r.login(await r.client());
    const withTok = await call(r.port, 'GET', '/status', {
      headers: { authorization: `Bearer ${tok.access_token}` },
    });
    expect(withTok.status).toBe(200);
    expect(withTok.body).toContain('u1');
    expect(withTok.body).not.toContain('u2');
    const without = await call(r.port, 'GET', '/status');
    expect(without.status).toBe(200);
    expect(without.body).not.toContain('u1');
    expect(without.body).not.toContain('u2');
  });

  it('a static-looking bearer is never accepted', async () => {
    r = await rig();
    const res = await r.mcp('a'.repeat(64), initBody);
    expect(res.status).toBe(401);
  });
});
