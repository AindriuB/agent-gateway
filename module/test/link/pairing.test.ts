/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

it('registers a settings menu Foundry would accept (ApplicationV2 subclass)', async () => {
  vi.resetModules();
  stub = installFoundry(14);
  const mod = await import('../../src/apps/pairing/index.js');
  mod.registerPairingMenu();
  const cfg = stub.registeredMenus.get('agent-gateway.pairing');
  expect(cfg.label).toBe('AGENT_GATEWAY.Pairing.menu.label');
  const V2 = (globalThis as any).foundry.applications.api.ApplicationV2;
  expect(cfg.type.prototype instanceof V2).toBe(true);
  const App = mod.createPairingApp();
  expect(App.DEFAULT_OPTIONS.window.title).toBe('AGENT_GATEWAY.Pairing.title');
  expect(App.PARTS.form.template).toContain('templates/pairing/pairing.hbs');
});

it('the stub rejects a non-ApplicationV2 menu type like Foundry', () => {
  stub = installFoundry(14);
  expect(() =>
    (globalThis as any).game.settings.registerMenu('x', 'y', { type: class {} }),
  ).toThrow(/ApplicationV2/);
});

it('describes link state with localized strings', async () => {
  vi.resetModules();
  stub = installFoundry(14);
  (globalThis as any).game.i18n = {
    localize: (k: string) => `L:${k}`,
    format: (k: string, d: any) => `F:${k}:${d.user}:${d.world}`,
  };
  const { describeState } = await import('../../src/apps/pairing/index.js');
  expect(describeState({ kind: 'connected', user: 'Gm', world: 'W' })).toBe(
    'F:AGENT_GATEWAY.Link.state.connected:Gm:W',
  );
  expect(describeState({ kind: 'disconnected', reason: 'PAIRING_INVALID' })).toBe(
    'L:AGENT_GATEWAY.Link.pairingInvalid',
  );
  expect(describeState({ kind: 'connecting' })).toBe('L:AGENT_GATEWAY.Link.state.connecting');
});
