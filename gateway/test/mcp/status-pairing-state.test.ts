import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createInvite } from '../../src/link/invites.js';
import { createSessionServer } from '../../src/mcp/session.js';
import { startServer, type Harness } from '../link/helpers.js';
import { expectErrorCode, fixtureTool, pairModule, until } from '../routing/harness.js';

let h: Harness | undefined;
const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

async function open(
  state: 'active' | 'revoked' | 'none' | undefined,
  over: { askOperator?: boolean; pairingHint?: () => { code: string; expiresInMin: number } } = {},
): Promise<Client> {
  const server = createSessionServer({
    version: '0.0.0',
    registry: h!.registry,
    selector: { world: 'w1', user: 'u1' },
    tools: [fixtureTool],
    knownIdentities: () => [{ worldId: 'w1', userId: 'u1', userName: 'Ann' }],
    ...(state
      ? { pairingState: (w: string, u: string) => (w === 'w1' && u === 'u1' ? state : 'none') }
      : {}),
    ...over,
  });
  const client = new Client({ name: 't', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  // Bind the session while its user is connected, then drop the browser: the offline case.
  const m = await pairModule(h!, 'u1', { userName: 'Ann' });
  await client.callTool({ name: 'gateway_status', arguments: {} });
  m.tc.ws.terminate();
  await until(() => h!.registry.get('w1', 'u1') === undefined);
  return client;
}
const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const structured = (r: unknown) =>
  (r as { structuredContent: Record<string, unknown> }).structuredContent;

async function both(c: Client) {
  const st = await c.callTool({ name: 'gateway_status', arguments: {} });
  const call = await c.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
  expectErrorCode(call as Record<string, unknown>, 'WORLD_OFFLINE');
  return { st, call };
}

describe('status wording by pairing state', () => {
  it('active: reopen the tab, no new invite or code', async () => {
    h = await startServer();
    const c = await open('active', { askOperator: true });
    const { st, call } = await both(c);
    for (const t of [text(st), text(call)]) {
      expect(t).toContain('open or reload the Foundry tab as Ann');
      expect(t).toContain('no new invite or code is needed');
      expect(t).not.toContain('ask the gateway operator');
      expect(t.toLowerCase()).not.toContain('ask the gateway operator');
      expect(t).not.toContain('invite from');
    }
    expect(structured(st).pairing).toBe('active');
  });

  it('active in local mode does not issue or show a pairing code', async () => {
    h = await startServer();
    let issued = 0;
    const c = await open('active', {
      pairingHint: () => {
        issued++;
        return { code: 'ABCD-EFGH', expiresInMin: 5 };
      },
    });
    const { st, call } = await both(c);
    expect(text(st)).not.toContain('ABCD-EFGH');
    expect(text(call)).not.toContain('ABCD-EFGH');
    expect(issued).toBe(0);
  });

  it('none: server mode asks for an invite; local mode keeps the code clause', async () => {
    h = await startServer();
    const server = await open('none', { askOperator: true });
    const s = await both(server);
    expect(text(s.st)).toContain('invite');
    expect(structured(s.st).pairing).toBe('none');
    expect(text(s.call)).toContain('ask the gateway operator for an invite');
    const local = await open('none', {
      pairingHint: () => ({ code: 'ABCD-EFGH', expiresInMin: 5 }),
    });
    const l = await both(local);
    expect(text(l.st)).toContain('enter code ABCD-EFGH');
    expect(text(l.call)).toContain('ABCD-EFGH');
    expect(structured(l.st).pairing).toBe('none');
  });

  it('revoked: says so and asks for a new invite', async () => {
    h = await startServer();
    const c = await open('revoked', { askOperator: true });
    const { st, call } = await both(c);
    for (const t of [text(st), text(call)]) {
      expect(t).toContain('was revoked');
      expect(t).toContain('new invite is needed');
    }
    expect(structured(st).pairing).toBe('revoked');
  });

  it('without pairingState the output is the older wording and has no pairing field', async () => {
    h = await startServer();
    const c = await open(undefined, { askOperator: true });
    const { st, call } = await both(c);
    expect(structured(st).pairing).toBeUndefined();
    expect(text(st)).toContain('Ask the gateway operator for an invite');
    expect(text(call)).toContain('ask the gateway operator for an invite');
  });

  it('never leaks an unredeemed invite code', async () => {
    h = await startServer();
    const { code } = createInvite(h.store, { worldId: 'w1', userId: 'u1' }, Date.now());
    for (const state of ['active', 'revoked', 'none'] as const) {
      const c = await open(state, { askOperator: true });
      const { st, call } = await both(c);
      expect(JSON.stringify([st, call])).not.toContain(code);
    }
  });
});
