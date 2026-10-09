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
  expect(describeState({ kind: 'disconnected', reason: 'REPLACED' })).toBe(
    'L:AGENT_GATEWAY.Link.replaced',
  );
  expect(describeState({ kind: 'connecting' })).toBe('L:AGENT_GATEWAY.Link.state.connecting');
});

async function submitWith(token: string, values: Record<string, string>, startState?: object) {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => k };
  const warn = vi.fn();
  g.ui = { notifications: { warn } };
  const client = {
    pair: vi.fn(),
    start: vi.fn(() => {
      if (startState) client.state = startState;
    }),
    state: { kind: 'connecting' } as object,
    hasStoredToken: () => token !== '',
  };
  vi.doMock('../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
  if (token) await g.game.settings.set('agent-gateway', 'pairingToken', token);
  const mod = await import('../../src/apps/pairing/index.js');
  const App = mod.createPairingApp();
  await App.onSubmit(new Event('submit'), {} as HTMLFormElement, { object: values });
  vi.doUnmock('../../src/link/runtime.js');
  return { client, warn, g };
}

it('submit with a code pairs and stores the gateway URL', async () => {
  const { client, g } = await submitWith('tok', { gatewayUrl: 'ws://gw', code: ' abc ' });
  expect(client.pair).toHaveBeenCalledWith('abc');
  expect(client.start).not.toHaveBeenCalled();
  expect(g.game.settings.get('agent-gateway', 'gatewayUrl')).toBe('ws://gw');
});

it('submit with an empty code and a stored token reclaims via start()', async () => {
  const { client, warn, g } = await submitWith('tok', { gatewayUrl: 'ws://new', code: '' });
  expect(client.start).toHaveBeenCalledTimes(1);
  expect(client.pair).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  expect(g.game.settings.get('agent-gateway', 'gatewayUrl')).toBe('ws://new');
});

it('submit with an empty code and no token warns and does nothing else', async () => {
  const { client, warn } = await submitWith('', { gatewayUrl: 'ws://gw', code: '' });
  expect(warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Link.codeRequired');
  expect(client.start).not.toHaveBeenCalled();
  expect(client.pair).not.toHaveBeenCalled();
});

it('submit with an empty code and a token from another gateway warns after start()', async () => {
  const { client, warn } = await submitWith(
    'tok',
    { gatewayUrl: 'ws://new', code: '' },
    { kind: 'disconnected', reason: 'PAIRING_REQUIRED' },
  );
  expect(client.start).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Link.codeRequired');
});

it('describes PAIRING_REQUIRED with its own localized key', async () => {
  vi.resetModules();
  stub = installFoundry(14);
  (globalThis as any).game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => k };
  const { describeState } = await import('../../src/apps/pairing/index.js');
  expect(describeState({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' })).toBe(
    'L:AGENT_GATEWAY.Link.pairingRequired',
  );
});

it('a state change updates only the status element, never re-rendering the form', async () => {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = { localize: (k: string) => `L:${k}`, format: (k: string) => k };
  let fire: () => void = () => {};
  const client = {
    state: { kind: 'connecting' } as any,
    onState: (fn: () => void) => {
      fire = fn;
      return () => {};
    },
  };
  vi.doMock('../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
  const mod = await import('../../src/apps/pairing/index.js');
  const App = mod.createPairingApp();
  const app = new App();
  const status = { textContent: '' };
  const code = { value: 'typed-code' };
  app.element = { querySelector: (q: string) => (q === '[data-role="status"]' ? status : code) };
  const render = vi.fn();
  app.render = render;
  await app._onRender({}, {});
  client.state = { kind: 'disconnected' };
  fire();
  expect(render).not.toHaveBeenCalled();
  expect(status.textContent).toBe('L:AGENT_GATEWAY.Link.state.disconnected');
  expect(code.value).toBe('typed-code');
  vi.doUnmock('../../src/link/runtime.js');
});
