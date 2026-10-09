/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

it('registers a settings menu and builds an ApplicationV2 subclass', async () => {
  vi.resetModules();
  stub = installFoundry(14);
  const menus: any[] = [];
  (globalThis as any).game.settings.registerMenu = (_ns: string, key: string, cfg: any) =>
    menus.push({ key, cfg });
  const mod = await import('../../src/apps/pairing/index.js');
  mod.registerPairingMenu();
  expect(menus[0].key).toBe('pairing');
  expect(menus[0].cfg.label).toBe('AGENT_GATEWAY.Pairing.menu.label');
  const App = mod.createPairingApp();
  expect(App.DEFAULT_OPTIONS.window.title).toBe('AGENT_GATEWAY.Pairing.title');
  expect(App.PARTS.form.template).toContain('templates/pairing/pairing.hbs');
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
