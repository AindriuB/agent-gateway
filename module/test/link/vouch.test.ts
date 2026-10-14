/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
let created: any[];
let hooks: Map<string, (...a: any[]) => void>;

const users = [
  { id: 'gm1', name: 'GM', isGM: true, active: true },
  { id: 'gm2', name: 'Co-GM', isGM: true, active: false },
  { id: 'gm3', name: 'Other GM', isGM: true, active: true },
  { id: 'p1', name: 'Player', isGM: false, active: true },
  { id: 'p2', name: 'Other', isGM: false, active: true },
];

async function load() {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => k };
  g.game.users = Object.assign([...users], { get: (id: string) => users.find((u) => u.id === id) });
  created = [];
  g.ChatMessage = { create: vi.fn(async (d: any) => created.push(d)) };
  hooks = new Map();
  g.Hooks = { on: (h: string, fn: any) => hooks.set(h, fn), once: vi.fn() };
  return import('../../src/link/vouch.js');
}

afterEach(() => {
  stub?.uninstall();
  delete (globalThis as any).ChatMessage;
  vi.restoreAllMocks();
});

const NONCE = 'SECRET-NONCE-0123456789';

describe('player side', () => {
  it('posts one whisper to the active GMs only, flagged with the nonce, with no secret in content', async () => {
    const { postVouch } = await load();
    expect(await postVouch(NONCE)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].whisper).toEqual(['gm1', 'gm3']);
    expect(created[0].flags).toEqual({ 'agent-gateway': { vouch: { nonce: NONCE } } });
    expect(created[0].content).toBe('L:AGENT_GATEWAY.Pairing.Vouch.content');
    expect(JSON.stringify(created[0].content)).not.toContain(NONCE);
    // No author is ever supplied: Foundry sets it on the server.
    expect(created[0]).not.toHaveProperty('author');
    expect(created[0]).not.toHaveProperty('user');
  });

  it('posts nothing when no GM is online, since an empty whisper would be public', async () => {
    const { postVouch } = await load();
    for (const u of users) u.active = u.id.startsWith('p');
    try {
      expect(await postVouch(NONCE)).toBe(false);
      expect(created).toEqual([]);
    } finally {
      users[0]!.active = true;
      users[2]!.active = true;
    }
  });
});

describe('admin side', () => {
  const message = (over: Record<string, unknown> = {}) => ({
    author: { id: 'p1' },
    flags: { 'agent-gateway': { vouch: { nonce: NONCE } } },
    content: 'ignored',
    delete: vi.fn(async () => undefined),
    ...over,
  });
  const client = (isAdmin = true) => ({ isAdmin, attest: vi.fn(() => true) });

  it('an admin vouches for the author Foundry set, then deletes the message', async () => {
    const { handleVouchMessage } = await load();
    const c = client();
    const m = message();
    await handleVouchMessage(m, c);
    expect(c.attest).toHaveBeenCalledExactlyOnceWith(NONCE, 'p1', false);
    expect(m.delete).toHaveBeenCalledTimes(1);
  });

  it('reports a GM author as a GM', async () => {
    const { handleVouchMessage } = await load();
    const c = client();
    await handleVouchMessage(message({ author: { id: 'gm3' } }), c);
    expect(c.attest).toHaveBeenCalledWith(NONCE, 'gm3', true);
  });

  it('reads the author, never a flag or the content: a forged authorId in the flag is ignored', async () => {
    const { handleVouchMessage } = await load();
    const c = client();
    await handleVouchMessage(
      message({
        author: { id: 'p2' },
        content: 'author p1',
        flags: { 'agent-gateway': { vouch: { nonce: NONCE, authorId: 'p1', author: 'p1' } } },
      }),
      c,
    );
    expect(c.attest).toHaveBeenCalledWith(NONCE, 'p2', false);
  });

  it('a non-admin client sends nothing and deletes nothing', async () => {
    const { handleVouchMessage } = await load();
    const c = client(false);
    const m = message();
    await handleVouchMessage(m, c);
    expect(c.attest).not.toHaveBeenCalled();
    expect(m.delete).not.toHaveBeenCalled();
  });

  it.each([
    ['no flag', { flags: {} }],
    ['no flags at all', { flags: undefined }],
    ['an array', { flags: { 'agent-gateway': { vouch: [NONCE] } } }],
    ['a string', { flags: { 'agent-gateway': { vouch: NONCE } } }],
    ['a numeric nonce', { flags: { 'agent-gateway': { vouch: { nonce: 5 } } } }],
    ['an empty nonce', { flags: { 'agent-gateway': { vouch: { nonce: '' } } } }],
    ['an oversize nonce', { flags: { 'agent-gateway': { vouch: { nonce: 'x'.repeat(201) } } } }],
    ['no author', { author: undefined }],
    ['an unknown author', { author: { id: 'ghost' } }],
  ])('%s: sends nothing', async (_n, over) => {
    const { handleVouchMessage } = await load();
    const c = client();
    const m = message(over);
    await handleVouchMessage(m, c);
    expect(c.attest).not.toHaveBeenCalled();
    expect(m.delete).not.toHaveBeenCalled();
  });

  it('does not delete a message whose attest was not sent', async () => {
    const { handleVouchMessage } = await load();
    const c = { isAdmin: true, attest: vi.fn(() => false) };
    const m = message();
    await handleVouchMessage(m, c);
    expect(m.delete).not.toHaveBeenCalled();
  });

  it('survives a failed delete', async () => {
    const { handleVouchMessage } = await load();
    const c = client();
    await expect(
      handleVouchMessage(
        message({ delete: vi.fn(async () => Promise.reject(new Error('gone'))) }),
        c,
      ),
    ).resolves.toBeUndefined();
    expect(c.attest).toHaveBeenCalled();
  });

  it('installVouchHook listens on createChatMessage', async () => {
    const { installVouchHook } = await load();
    const c = client();
    installVouchHook(c);
    hooks.get('createChatMessage')!(message());
    await Promise.resolve();
    await Promise.resolve();
    expect(c.attest).toHaveBeenCalledTimes(1);
  });
});

describe('pairing window and indicator', () => {
  it('shows localized waiting and unconfirmed states and no secret', async () => {
    await load();
    const { describeState } = await import('../../src/apps/pairing/index.js');
    expect(describeState({ kind: 'awaiting-gm' }, true)).toBe(
      'L:AGENT_GATEWAY.Pairing.Vouch.waiting',
    );
    expect(describeState({ kind: 'disconnected', reason: 'PAIRING_UNCONFIRMED' }, true)).toBe(
      'L:AGENT_GATEWAY.Pairing.Vouch.unconfirmed',
    );
  });

  it('the rendered context carries no nonce, token or code', async () => {
    await load();
    const g = globalThis as any;
    g.ui = { notifications: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } };
    const client = {
      state: { kind: 'awaiting-gm' } as object,
      hasCurrentGatewayToken: () => false,
      onState: () => () => undefined,
    };
    vi.doMock('../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
    const mod = await import('../../src/apps/pairing/index.js');
    const App = mod.createPairingApp();
    const ctx = await App.prototype._prepareContext.call({});
    vi.doUnmock('../../src/link/runtime.js');
    expect(ctx.status).toBe('L:AGENT_GATEWAY.Pairing.Vouch.waiting');
    for (const secret of [NONCE, 'CODE-SECRET', 'tok'])
      expect(JSON.stringify(ctx)).not.toContain(secret);
    expect(g.ui.notifications.warn).not.toHaveBeenCalled();
  });

  it('the indicator maps awaiting-gm to its own localized state', async () => {
    const { indicatorState } = await import('../../src/link/status-indicator.js');
    expect(indicatorState({ kind: 'awaiting-gm' }, true)).toBe('awaitingGm');
    expect(indicatorState({ kind: 'disconnected', reason: 'PAIRING_UNCONFIRMED' }, true)).toBe(
      'hidden',
    );
  });
});
