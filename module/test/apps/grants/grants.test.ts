/* eslint-disable @typescript-eslint/no-explicit-any */
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LinkClient,
  gatewaySupportsGrants,
  type GrantSummary,
  type SocketLike,
} from '../../../src/link/client.js';
import { installFoundry, type FoundryStub } from '../../stubs/foundry.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  sent: any[] = [];
  send(d: string) {
    this.sent.push(JSON.parse(d));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const welcome = (gatewayVersion: string) => ({
  type: 'welcome',
  gatewayVersion,
  protocolVersion: PROTOCOL_VERSION,
  connectionId: 'c1',
  agentId: 'a1',
});

const grant = (over: Partial<GrantSummary> = {}): GrantSummary => ({
  id: 'g1',
  clientName: 'Claude',
  scopes: ['read'],
  createdAt: 1_700_000_000_000,
  lastUsedAt: null,
  ...over,
});

let sockets: FakeSocket[];
function connected(gatewayVersion: string): { client: LinkClient; ws: FakeSocket } {
  sockets = [];
  const client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => ({ url: 'ws://gw', token: 'tok' }),
    setToken: () => undefined,
    getIdentity: () => ({
      moduleVersion: '0.1.0',
      foundryVersion: '14.0',
      world: { id: 'w', title: 'W', system: 'dnd5e', systemVersion: '5' },
      user: { id: 'u', name: 'Gm', role: 4, isGM: true },
    }),
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    notifyError: () => undefined,
  });
  client.start();
  const ws = sockets[0]!;
  ws.onopen?.();
  ws.recv(welcome(gatewayVersion));
  return { client, ws };
}

describe('the link client', () => {
  it('lists and revokes, correlating by request id', async () => {
    const { client, ws } = connected('0.1.0');
    const listing = client.listGrants();
    const sent = ws.sent.at(-1);
    expect(sent).toMatchObject({ type: 'listGrants' });
    expect(Object.keys(sent).sort()).toEqual(['requestId', 'type']);
    ws.recv({ type: 'grants', requestId: 'foreign', grants: [] });
    ws.recv({ type: 'grants', requestId: sent.requestId, grants: [grant()] });
    await expect(listing).resolves.toEqual([grant()]);

    const revoking = client.revokeGrant('g1');
    const rv = ws.sent.at(-1);
    expect(rv).toMatchObject({ type: 'revokeGrant', grantId: 'g1' });
    ws.recv({ type: 'grants', requestId: rv.requestId, grants: [] });
    await expect(revoking).resolves.toEqual([]);
  });

  it('sends no grant message to a gateway reporting a version below the minimum', async () => {
    const { client, ws } = connected('0.0.9');
    const before = ws.sent.length;
    await expect(client.listGrants()).rejects.toThrow(/too old/);
    await expect(client.revokeGrant('g1')).rejects.toThrow(/too old/);
    expect(ws.sent).toHaveLength(before);
  });

  it('compares versions', () => {
    expect(gatewaySupportsGrants('0.1.0')).toBe(true);
    expect(gatewaySupportsGrants('0.2.3')).toBe(true);
    expect(gatewaySupportsGrants('1.0.0')).toBe(true);
    expect(gatewaySupportsGrants('0.0.9')).toBe(false);
    expect(gatewaySupportsGrants('garbage')).toBe(false);
    expect(gatewaySupportsGrants(null)).toBe(false);
  });

  it('passes a consent code to listeners and rejects pending requests on disconnect', async () => {
    const { client, ws } = connected('0.1.0');
    const got: string[] = [];
    client.onConsentCode((m) => got.push(m.code));
    ws.recv({
      type: 'consentCode',
      code: '12345678',
      clientName: 'C',
      scopes: ['read'],
      expiresAt: 1,
    });
    expect(got).toEqual(['12345678']);
    const pending = client.listGrants();
    client.stop();
    await expect(pending).rejects.toThrow(/disconnected/);
    expect(client.gatewayVersion).toBeNull();
  });
});

describe('the grants app', () => {
  let stub: FoundryStub;
  afterEach(() => stub?.uninstall());
  beforeEach(() => vi.resetModules());

  async function load(client: object) {
    vi.doMock('../../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
    stub = installFoundry(14);
    const g = globalThis as any;
    g.game.i18n = {
      localize: (k: string) => `L:${k}`,
      format: (k: string, d: any) => `F:${k}:${JSON.stringify(d)}`,
    };
    g.ui = { notifications: { info: vi.fn(), warn: vi.fn() } };
    return await import('../../../src/apps/grants/index.js');
  }

  it('registers a menu Foundry would accept, with a template that exists', async () => {
    const mod = await load({ onConsentCode: vi.fn() });
    mod.registerGrantsMenu();
    const cfg = stub.registeredMenus.get('agent-gateway.grants');
    expect(cfg.label).toBe('AGENT_GATEWAY.Grants.menu.label');
    const V2 = (globalThis as any).foundry.applications.api.ApplicationV2;
    expect(cfg.type.prototype instanceof V2).toBe(true);
    const App = mod.createGrantsApp();
    const file = App.PARTS.list.template.replace(/^modules\/agent-gateway\//, '');
    expect(readFileSync(resolve(__dirname, '../../../../', file), 'utf8')).toContain(
      'data-action="revoke"',
    );
  });

  it('lists the current user grants as plain bounded text', async () => {
    const client = {
      state: { kind: 'connected' },
      gatewayVersion: '0.1.0',
      listGrants: vi.fn(async () => [
        grant({
          clientName: '<script>x</script>\u0007',
          scopes: ['read', 'write'],
          lastUsedAt: 1_700_000_100_000,
        }),
      ]),
    };
    const mod = await load(client);
    const ctx = await mod.prepareGrants();
    expect(ctx.unavailable).toBe('');
    expect(ctx.rows).toEqual([
      {
        id: 'g1',
        clientName: '<script>x</script>',
        scopes: 'read, write',
        created: '2023-11-14 22:13:20',
        lastUsed: '2023-11-14 22:15:00',
      },
    ]);
    // The template prints with {{ }}, which escapes; it must never use the raw form.
    const tpl = readFileSync(resolve(__dirname, '../../../../templates/grants/grants.hbs'), 'utf8');
    expect(tpl).not.toContain('{{{');
  });

  it('tells the player their GM can see the list, whatever state the window is in', () => {
    const tpl = readFileSync(resolve(__dirname, '../../../../templates/grants/grants.hbs'), 'utf8');
    const line = tpl.indexOf('"AGENT_GATEWAY.Grants.gmCanSee"');
    expect(line).toBeGreaterThan(-1);
    // Rendered before any conditional, so the offline and too-old states show it too.
    expect(line).toBeLessThan(tpl.indexOf('{{#if'));
    const lang = JSON.parse(
      readFileSync(resolve(__dirname, '../../../../lang/en.json'), 'utf8'),
    ) as Record<string, string>;
    expect(lang['AGENT_GATEWAY.Grants.gmCanSee']).toMatch(/GM can see/);
    expect(lang['AGENT_GATEWAY.Grants.gmCanSee']).toMatch(/never any tokens/);
  });

  it('explains instead of asking when offline or when the gateway is too old', async () => {
    const off = await load({ state: { kind: 'disconnected' }, listGrants: vi.fn() });
    expect((await off.prepareGrants()).unavailable).toBe('L:AGENT_GATEWAY.Grants.offline');
    vi.resetModules();
    const listGrants = vi.fn();
    const old = await load({ state: { kind: 'connected' }, gatewayVersion: '0.0.1', listGrants });
    expect((await old.prepareGrants()).unavailable).toBe('L:AGENT_GATEWAY.Grants.tooOld');
    expect(listGrants).not.toHaveBeenCalled();
  });

  it('revokes through the link and re-renders', async () => {
    const revokeGrant = vi.fn(async () => []);
    const mod = await load({ revokeGrant });
    const App = mod.createGrantsApp();
    const render = vi.fn();
    await App.onRevoke.call({ render }, new Event('click'), { dataset: { grantId: 'g1' } });
    expect(revokeGrant).toHaveBeenCalledWith('g1');
    expect(render).toHaveBeenCalled();
  });

  it('shows a consent code with everything escaped', async () => {
    const prompt = vi.fn(async () => undefined);
    const mod = await load({});
    (globalThis as any).foundry.applications.api.DialogV2 = { prompt };
    mod.showConsentCode({
      type: 'consentCode',
      code: '12345678',
      clientName: '<img src=x onerror=1>',
      scopes: ['read'],
      expiresAt: 1,
    });
    const content = (prompt.mock.calls[0] as any)[0].content as string;
    expect(content).toContain('12345678');
    expect(content).not.toContain('<img');
  });

  it('has every string it uses in lang/en.json', () => {
    const lang = JSON.parse(readFileSync(resolve(__dirname, '../../../../lang/en.json'), 'utf8'));
    const flat = (o: any, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const keys = new Set(flat(lang));
    const src = [
      readFileSync(resolve(__dirname, '../../../src/apps/grants/index.ts'), 'utf8'),
      readFileSync(resolve(__dirname, '../../../../templates/grants/grants.hbs'), 'utf8'),
    ].join('\n');
    const used = [...src.matchAll(/AGENT_GATEWAY\.(?:Grants|Consent)\.[A-Za-z.]+/g)].map(
      (m) => m[0],
    );
    expect(used.length).toBeGreaterThan(8);
    for (const k of used) expect(keys.has(k), k).toBe(true);
  });
});
