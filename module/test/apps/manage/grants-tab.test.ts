/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installFoundry, type FoundryStub } from '../../stubs/foundry.js';

const root = resolve(__dirname, '../../../../');

const pairing = (over: object = {}) => ({
  id: 'p1',
  userId: 'u1',
  userName: 'Una',
  origin: null,
  createdAt: 1,
  admin: false,
  connected: true,
  self: false,
  ...over,
});
const grant = (over: object = {}) => ({
  id: 'g1',
  clientName: 'Claude',
  scopes: ['read', 'write'],
  createdAt: 1_700_000_000_000,
  lastUsedAt: null,
  ...over,
});

function adminClient(over: object = {}): any {
  return {
    state: { kind: 'connected' },
    isAdmin: true,
    gatewayVersion: '0.3.0',
    listInvites: vi.fn(async () => []),
    listPairings: vi.fn(async () => [
      pairing({ id: 'pg', userId: 'gm', userName: 'The GM', admin: true, self: true }),
      pairing(),
      pairing({ id: 'p2', userId: 'u2', userName: 'Bo' }),
      pairing({ id: 'p3', userId: 'gm2', userName: 'Other GM', admin: true }),
      pairing({ id: 'p4', userId: 'u2', userName: 'Bo' }),
    ]),
    listUserGrants: vi.fn(async () => [grant()]),
    revokeUserGrant: vi.fn(async () => []),
    ...over,
  };
}

describe('the Grants tab of the management app', () => {
  let stub: FoundryStub;
  afterEach(() => {
    stub?.uninstall();
    vi.restoreAllMocks();
  });
  beforeEach(() => vi.resetModules());

  async function load(client: object) {
    vi.doMock('../../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
    stub = installFoundry(14);
    const g = globalThis as any;
    g.game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => k };
    g.game.users = { contents: [] };
    g.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    return await import('../../../src/apps/manage/index.js');
  }

  it('lists paired users once each, leaving out other admin GMs, and the first one is shown', async () => {
    const client = adminClient();
    const mod = await load(client);
    const ctx = await mod.prepareManage('grants');
    expect(ctx.isGrants).toBe(true);
    expect(ctx.grantUsers.map((u) => [u.id, u.selected])).toEqual([
      ['gm', true],
      ['u1', false],
      ['u2', false],
    ]);
    expect(client.listUserGrants).toHaveBeenCalledWith('gm');
    expect(ctx.grants).toEqual([
      expect.objectContaining({ id: 'g1', clientName: 'Claude', scopes: 'read, write' }),
    ]);
    expect(ctx.grants[0]!.created).toBe('2023-11-14 22:13:20');
  });

  it('shows the grants of the selected user, and falls back when that user is not listed', async () => {
    const client = adminClient();
    const mod = await load(client);
    const ctx = await mod.prepareManage('grants', 'u2');
    expect(ctx.grantUsers.find((u) => u.selected)!.id).toBe('u2');
    expect(client.listUserGrants).toHaveBeenCalledWith('u2');
    // A forged or other-admin id is never requested.
    await mod.prepareManage('grants', 'gm2');
    expect(client.listUserGrants).not.toHaveBeenCalledWith('gm2');
  });

  it('says so when no user has a pairing, and asks for nothing', async () => {
    const client = adminClient({ listPairings: vi.fn(async () => []) });
    const mod = await load(client);
    const ctx = await mod.prepareManage('grants');
    expect(ctx.emptyGrantUsers).toBe(true);
    expect(client.listUserGrants).not.toHaveBeenCalled();
  });

  it('is gated like Pairings: 0.3.0 and later, the nav kept otherwise', async () => {
    const v2 = adminClient({ gatewayVersion: '0.2.0' });
    const mod = await load(v2);
    const ctx = await mod.prepareManage('grants');
    expect(ctx.unavailable).toBe('');
    expect(ctx.notice).toBe('L:AGENT_GATEWAY.Manage.tooOld');
    expect(v2.listPairings).not.toHaveBeenCalled();
    const App = mod.createManageApp();
    await App.onRevokeUserGrant.call({ render: vi.fn() }, new Event('x'), {
      dataset: { userId: 'u1', grantId: 'g1' },
    });
    expect(v2.revokeUserGrant).not.toHaveBeenCalled();
  });

  it('sends nothing to a non-admin', async () => {
    const client = adminClient({ isAdmin: false });
    const mod = await load(client);
    expect((await mod.prepareManage('grants')).unavailable).toBe('L:AGENT_GATEWAY.Manage.notAdmin');
    const App = mod.createManageApp();
    await App.onRevokeUserGrant.call({ render: vi.fn() }, new Event('x'), {
      dataset: { userId: 'u1', grantId: 'g1' },
    });
    expect(client.listPairings).not.toHaveBeenCalled();
    expect(client.revokeUserGrant).not.toHaveBeenCalled();
  });

  it('keeps the nav and offers retry when the grants request fails or times out', async () => {
    const { ManageError } = await import('../../../src/link/client.js');
    const client = adminClient({
      listUserGrants: vi.fn(async () => {
        throw new ManageError('TIMEOUT', 'x');
      }),
    });
    const mod = await load(client);
    const ctx = await mod.prepareManage('grants');
    expect(ctx.unavailable).toBe('');
    expect(ctx.notice).toBe('L:AGENT_GATEWAY.Manage.timeout');
    expect(ctx.canRetry).toBe(true);
    const forbidden = await mod.prepareManage('grants', 'u1');
    expect(forbidden.unavailable).toBe('');
  });

  it('revokes through the client for that user, and selects a user', async () => {
    const client = adminClient();
    const mod = await load(client);
    const App = mod.createManageApp();
    const self: any = { tab: 'grants', render: vi.fn() };
    await App.onSelectGrantUser.call(self, new Event('x'), { dataset: { userId: 'u2' } });
    expect(self.grantUser).toBe('u2');
    expect(self.render).toHaveBeenCalledOnce();
    await App.onRevokeUserGrant.call(self, new Event('x'), {
      dataset: { userId: 'u2', grantId: 'g9' },
    });
    expect(client.revokeUserGrant).toHaveBeenCalledWith('u2', 'g9');
    await App.onRevokeUserGrant.call(self, new Event('x'), { dataset: { grantId: 'g9' } });
    expect(client.revokeUserGrant).toHaveBeenCalledOnce();
    const tab = { tab: 'invites', render: vi.fn() };
    await App.onTab.call(tab, new Event('x'), { dataset: { tab: 'grants' } });
    expect(tab.tab).toBe('grants');
  });

  it('keeps a hostile client name as plain text under escaped template tags', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const client = adminClient({
      listUserGrants: vi.fn(async () => [grant({ clientName: evil })]),
    });
    const mod = await load(client);
    const ctx = await mod.prepareManage('grants');
    expect(ctx.grants[0]!.clientName).toBe(evil);
    const tpl = readFileSync(resolve(root, 'templates/manage/manage.hbs'), 'utf8');
    expect(tpl).toContain('{{clientName}}');
    expect(tpl).not.toMatch(/\{\{\{|\{\{&/);
  });

  it('carries no token, hash or secret, and states in the header that it is metadata only', async () => {
    const client = adminClient({
      listUserGrants: vi.fn(async () => [
        { ...grant(), tokenHash: 'TOKHASH', secret: 'SECRETVALUE' },
      ]),
    });
    const mod = await load(client);
    const text = JSON.stringify(await mod.prepareManage('grants'));
    expect(text).not.toContain('TOKHASH');
    expect(text).not.toContain('SECRETVALUE');
    const tpl = readFileSync(resolve(root, 'templates/manage/manage.hbs'), 'utf8');
    expect(tpl).toContain('"AGENT_GATEWAY.Manage.grantsIntro"');
    expect(tpl).toContain('data-action="revokeUserGrant"');
    const lang = JSON.parse(readFileSync(resolve(root, 'lang/en.json'), 'utf8'));
    expect(lang['AGENT_GATEWAY.Manage.grantsIntro']).toMatch(/metadata/i);
    expect(lang['AGENT_GATEWAY.Manage.grantsIntro']).toMatch(/players? (are|is) told/i);
    for (const k of [
      'tabGrants',
      'noGrantUsers',
      'noUserGrants',
      'grantRevoked',
      'scopes',
      'authorized',
    ])
      expect(lang[`AGENT_GATEWAY.Manage.${k}`], k).toBeTruthy();
  });
});
