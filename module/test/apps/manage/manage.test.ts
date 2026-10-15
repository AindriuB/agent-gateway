/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installFoundry, type FoundryStub } from '../../stubs/foundry.js';

const root = resolve(__dirname, '../../../../');
const SECRET = 'SECRETCODE123';

const pairing = (over: object = {}) => ({
  id: 'p1',
  userId: 'u1',
  userName: 'Una',
  origin: 'https://foundry.test',
  createdAt: 1_700_000_000_000,
  admin: false,
  connected: true,
  self: false,
  ...over,
});
const invite = (over: object = {}) => ({
  id: 'i1',
  userId: 'u1',
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_003_600_000,
  status: 'unused',
  ...over,
});

function adminClient(over: object = {}): any {
  return {
    state: { kind: 'connected' },
    isAdmin: true,
    gatewayVersion: '0.2.0',
    listInvites: vi.fn(async () => [invite()]),
    createInvite: vi.fn(async () => ({
      type: 'inviteCreated',
      requestId: 'r',
      inviteId: 'i2',
      code: SECRET,
      expiresAt: 5,
    })),
    cancelInvite: vi.fn(async () => []),
    listPairings: vi.fn(async () => [pairing()]),
    revokePairing: vi.fn(async () => []),
    ...over,
  };
}

describe('the management app', () => {
  let stub: FoundryStub;
  let prompt: ReturnType<typeof vi.fn>;
  let confirm: ReturnType<typeof vi.fn>;
  let settingsSet: ReturnType<typeof vi.fn>;
  afterEach(() => {
    stub?.uninstall();
    vi.restoreAllMocks();
  });
  beforeEach(() => vi.resetModules());

  async function load(client: object) {
    vi.doMock('../../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
    stub = installFoundry(14);
    const g = globalThis as any;
    g.game.i18n = {
      localize: (k: string) => `L:${k}`,
      format: (k: string, d: any) => `F:${k}:${JSON.stringify(d)}`,
    };
    g.game.users = {
      contents: [
        { id: 'gm', name: 'The GM', isGM: true },
        { id: 'u1', name: 'Una', isGM: false },
        { id: 'u2', name: 'Bo', isGM: false },
      ],
    };
    settingsSet = vi.fn();
    const baseGet = g.game.settings.get;
    g.game.settings.get = (ns: string, key: string) =>
      key === 'gatewayUrl' ? 'wss://gw.example/link' : baseGet(ns, key);
    g.game.settings.set = settingsSet;
    g.ui = { notifications: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    prompt = vi.fn(async () => undefined);
    confirm = vi.fn(async () => true);
    g.foundry.applications.api.DialogV2 = { prompt, confirm };
    return await import('../../../src/apps/manage/index.js');
  }

  it('is a restricted settings menu with templates that exist and never print raw', async () => {
    const mod = await load(adminClient());
    mod.registerManageMenu();
    const cfg = stub.registeredMenus.get('agent-gateway.manage');
    expect(cfg.restricted).toBe(true);
    const V2 = (globalThis as any).foundry.applications.api.ApplicationV2;
    expect(cfg.type.prototype instanceof V2).toBe(true);
    const App = mod.createManageApp();
    const file = App.PARTS.body.template.replace(/^modules\/agent-gateway\//, '');
    const tpl = readFileSync(resolve(root, file), 'utf8');
    expect(tpl).not.toContain('{{{');
    expect(tpl).not.toMatch(/innerHTML/);
  });

  it('shows the not-admin state and sends nothing to a non-admin', async () => {
    const client = adminClient({ isAdmin: false });
    const mod = await load(client);
    const ctx = await mod.prepareManage('invites');
    expect(ctx.unavailable).toBe('L:AGENT_GATEWAY.Manage.notAdmin');
    await mod.prepareManage('pairings');
    expect(client.listInvites).not.toHaveBeenCalled();
    expect(client.listPairings).not.toHaveBeenCalled();
    // The actions refuse too.
    const App = mod.createManageApp();
    const self = { render: vi.fn(), element: null };
    await App.onCancelInvite.call(self, new Event('x'), { dataset: { inviteId: 'i1' } });
    await App.onRevokePairing.call(self, new Event('x'), {
      dataset: { pairingId: 'p1', canRevoke: 'true' },
    });
    expect(client.cancelInvite).not.toHaveBeenCalled();
    expect(client.revokePairing).not.toHaveBeenCalled();
  });

  it('shows localized offline, old-gateway and timeout states', async () => {
    const off = await load(adminClient({ state: { kind: 'disconnected' } }));
    expect((await off.prepareManage()).unavailable).toBe('L:AGENT_GATEWAY.Manage.offline');
    vi.resetModules();
    const mismatch = await load(
      adminClient({ state: { kind: 'disconnected', reason: 'PROTOCOL_MAJOR_MISMATCH' } }),
    );
    expect((await mismatch.prepareManage()).unavailable).toBe('L:AGENT_GATEWAY.Manage.tooOld');
    vi.resetModules();
    const listInvites = vi.fn();
    const old = await load(adminClient({ gatewayVersion: '0.1.0', listInvites }));
    expect((await old.prepareManage()).unavailable).toBe('L:AGENT_GATEWAY.Manage.tooOld');
    expect(listInvites).not.toHaveBeenCalled();
    vi.resetModules();
    // The app and this test must share one module instance of the error class.
    const { ManageError } = await import('../../../src/link/client.js');
    const slow = await load(
      adminClient({
        listInvites: vi.fn(async () => {
          throw new ManageError('TIMEOUT', 'x');
        }),
      }),
    );
    expect((await slow.prepareManage()).unavailable).toBe('L:AGENT_GATEWAY.Manage.timeout');
  });

  it('lists invites with names resolved, falling back to the id, and only players to invite', async () => {
    const client = adminClient({
      listInvites: vi.fn(async () => [
        invite(),
        invite({ id: 'i2', userId: 'gone', status: 'expired' }),
      ]),
    });
    const mod = await load(client);
    const ctx = await mod.prepareManage('invites');
    expect(ctx.invites.map((r) => r.userName)).toEqual(['Una', 'gone']);
    expect(ctx.invites[0]).toMatchObject({
      status: 'L:AGENT_GATEWAY.Manage.status.unused',
      expires: '2023-11-14 23:13:20',
      canCancel: true,
    });
    expect(ctx.invites[1]!.canCancel).toBe(false);
    expect(ctx.users.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(ctx.ttls.length).toBeGreaterThan(0);
  });

  it('shows a new code once as <gateway URL>#<code> and keeps it nowhere else', async () => {
    const client = adminClient();
    const mod = await load(client);
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((m) =>
      vi.spyOn(console, m as any).mockImplementation(() => undefined),
    );
    const App = mod.createManageApp();
    const form = {
      '[name="userId"]': { value: 'u1' },
      '[name="ttlMs"]': { value: '3600000' },
    } as any;
    const self = {
      render: vi.fn(),
      element: { querySelector: (s: string) => form[s] },
    };
    await App.onCreateInvite.call(self, new Event('x'), {});
    expect(client.createInvite).toHaveBeenCalledWith('u1', 3_600_000);
    expect(prompt).toHaveBeenCalledOnce();
    const content: string = (prompt.mock.calls[0]![0] as any).content;
    expect(content).toContain(`wss://gw.example/link#${SECRET}`);
    // Not on the next render, in console, notifications or settings.
    expect(JSON.stringify(await mod.prepareManage('invites'))).not.toContain(SECRET);
    expect(JSON.stringify(await mod.prepareManage('pairings'))).not.toContain(SECRET);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(SECRET);
    const ui = (globalThis as any).ui.notifications;
    for (const k of ['info', 'warn', 'error'])
      expect(JSON.stringify(ui[k].mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(settingsSet.mock.calls)).not.toContain(SECRET);
    expect(self.render).toHaveBeenCalled();
  });

  it('refuses to create an invite for a GM or an unknown user', async () => {
    const client = adminClient();
    const mod = await load(client);
    const App = mod.createManageApp();
    for (const id of ['gm', 'nobody']) {
      const self = {
        render: vi.fn(),
        element: {
          querySelector: (s: string) => (s.includes('userId') ? { value: id } : { value: '1' }),
        },
      };
      await App.onCreateInvite.call(self, new Event('x'), {});
    }
    expect(client.createInvite).not.toHaveBeenCalled();
  });

  it('cancels an invite', async () => {
    const client = adminClient();
    const mod = await load(client);
    const App = mod.createManageApp();
    const self = { render: vi.fn() };
    await App.onCancelInvite.call(self, new Event('x'), { dataset: { inviteId: 'i1' } });
    expect(client.cancelInvite).toHaveBeenCalledWith('i1');
    expect(self.render).toHaveBeenCalled();
  });

  it('lists pairings, disabling revoke for other admins only', async () => {
    const client = adminClient({
      listPairings: vi.fn(async () => [
        pairing(),
        pairing({ id: 'p2', admin: true }),
        pairing({ id: 'p3', admin: true, self: true }),
      ]),
    });
    const mod = await load(client);
    const ctx = await mod.prepareManage('pairings');
    expect(ctx.pairings.map((p) => p.canRevoke)).toEqual([true, false, true]);
    const tpl = readFileSync(resolve(root, 'templates/manage/manage.hbs'), 'utf8');
    expect(tpl).toContain('{{#unless canRevoke}}disabled{{/unless}}');
  });

  it('revokes a pairing, and asks first for the sender own row', async () => {
    const client = adminClient();
    const mod = await load(client);
    const App = mod.createManageApp();
    const self = { render: vi.fn() };
    await App.onRevokePairing.call(self, new Event('x'), {
      dataset: { pairingId: 'p1', canRevoke: 'true', self: 'false' },
    });
    expect(client.revokePairing).toHaveBeenCalledWith('p1');
    expect(confirm).not.toHaveBeenCalled();

    client.revokePairing.mockClear();
    confirm.mockResolvedValueOnce(false);
    await App.onRevokePairing.call(self, new Event('x'), {
      dataset: { pairingId: 'p9', canRevoke: 'true', self: 'true' },
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(client.revokePairing).not.toHaveBeenCalled();
    await App.onRevokePairing.call(self, new Event('x'), {
      dataset: { pairingId: 'p9', canRevoke: 'true', self: 'true' },
    });
    expect(client.revokePairing).toHaveBeenCalledWith('p9');
  });

  it('does not revoke a row marked as not revocable', async () => {
    const client = adminClient();
    const mod = await load(client);
    const App = mod.createManageApp();
    await App.onRevokePairing.call({ render: vi.fn() }, new Event('x'), {
      dataset: { pairingId: 'p2', canRevoke: 'false', self: 'false' },
    });
    expect(client.revokePairing).not.toHaveBeenCalled();
  });

  it('keeps hostile names as plain text, escaped by the template tags', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const client = adminClient({
      listPairings: vi.fn(async () => [pairing({ userName: evil, origin: evil })]),
      listInvites: vi.fn(async () => [invite({ userId: evil })]),
    });
    const mod = await load(client);
    const ctx = await mod.prepareManage('pairings');
    expect(ctx.pairings[0]!.userName).toBe(evil);
    // Render the template's value tags the way Handlebars does: HTML-escaped.
    const tpl = readFileSync(resolve(root, 'templates/manage/manage.hbs'), 'utf8');
    const esc = (s: string) =>
      s.replace(/[&<>"'`=]/g, (c) => `&#x${c.charCodeAt(0).toString(16)};`);
    const html = tpl.replace(/\{\{(userName|origin)\}\}/g, (_m, k) =>
      esc((ctx.pairings[0] as any)[k]),
    );
    expect(html).toContain('&#x3c;img src&#x3d;x onerror&#x3d;alert(1)&#x3e;');
    expect(html).not.toContain(evil);
    // Every value tag in the template is the escaped form.
    expect(tpl).not.toMatch(/\{\{\{|\{\{&/);
    const inv = await mod.prepareManage('invites');
    expect(inv.invites[0]!.userName).toBe(evil);
  });

  it('escapes the code dialog content', async () => {
    const mod = await load(adminClient());
    mod.showInviteCode('"><b>x</b>');
    const content: string = (prompt.mock.calls[0]![0] as any).content;
    expect(content).not.toContain('<b>');
    expect(content).toContain('&#60;b&#62;');
  });
});
