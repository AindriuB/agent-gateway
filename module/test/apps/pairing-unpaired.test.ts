/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  vi.doUnmock('../../src/link/runtime.js');
});

async function setup(opts: { url: string; token: boolean; gm?: boolean; state?: any }) {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => `F:${k}` };
  g.game.world = { id: 'w' };
  g.game.user = { id: 'u', isGM: opts.gm === true };
  g.game.settings.get = (_ns: string, key: string) => (key === 'gatewayUrl' ? opts.url : '');
  vi.doMock('../../src/link/runtime.js', () => ({
    getLinkClient: () => ({
      state: opts.state ?? { kind: 'disconnected' },
      onState: () => () => undefined,
      hasCurrentGatewayToken: () => opts.token,
    }),
  }));
  const mod = await import('../../src/apps/pairing/index.js');
  const ctx = (await new (mod.createPairingApp())()._prepareContext()) as any;
  return ctx;
}

it.each([
  ['server', 'wss://gw.example.com/link'],
  ['local', 'ws://localhost:8787'],
])('says this browser is unpaired in %s mode', async (_n, url) => {
  const ctx = await setup({ url, token: false });
  expect(ctx.status).toBe('L:AGENT_GATEWAY.Pairing.Unpaired.status');
});

it('keeps the old text with no address set', async () => {
  const ctx = await setup({ url: '', token: false });
  expect(ctx.status).toBe('L:AGENT_GATEWAY.Link.state.disconnected');
});

it('keeps the old text when paired, or when a reason is present', async () => {
  expect((await setup({ url: 'wss://gw.example.com/link', token: true })).status).toBe(
    'L:AGENT_GATEWAY.Link.state.disconnected',
  );
  const ctx = await setup({
    url: 'wss://gw.example.com/link',
    token: false,
    state: { kind: 'disconnected', reason: 'PAIRING_REQUIRED' },
  });
  expect(ctx.status).toBe('L:AGENT_GATEWAY.Pairing.Server.pairingRequired');
});

it('shows a player hint to players and operator wording to a GM', async () => {
  expect((await setup({ url: '', token: false })).idsHint).toBe(
    'L:AGENT_GATEWAY.Pairing.CopyIds.playerHint',
  );
  expect((await setup({ url: '', token: false, gm: true })).idsHint).toBe(
    'L:AGENT_GATEWAY.Pairing.CopyIds.hint',
  );
});
