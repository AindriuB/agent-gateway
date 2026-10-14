/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  vi.doUnmock('../../src/link/runtime.js');
});

const root = resolve(__dirname, '../../..');
const lang = JSON.parse(readFileSync(resolve(root, 'lang/en.json'), 'utf8')) as any;
const template = readFileSync(resolve(root, 'templates/pairing/pairing.hbs'), 'utf8');

async function setup(url: string) {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = {
    localize: (k: string) => `L:${k}`,
    format: (k: string) => k,
  };
  g.game.world = { id: 'w1' };
  g.game.user = { id: 'u1' };
  g.game.settings.get = () => url;
  vi.doMock('../../src/link/runtime.js', () => ({
    getLinkClient: () => ({ state: { kind: 'connecting' }, onState: () => () => undefined }),
  }));
  const mod = await import('../../src/apps/pairing/index.js');
  return mod;
}

it.each([
  ['local mode', 'ws://127.0.0.1:7421'],
  ['server mode', 'wss://gw.example.com/link'],
])('the pairing window carries the one-pairing notice in %s', async (_n, url) => {
  const mod = await setup(url);
  const App = mod.createPairingApp();
  const ctx = (await new App()._prepareContext()) as { onePairingNotice: string };
  expect(ctx.onePairingNotice).toBe('L:AGENT_GATEWAY.Pairing.OnePerUser.notice');
  // The template shows it next to the submit button.
  expect(template.indexOf('{{onePairingNotice}}')).toBeGreaterThan(-1);
  expect(template.indexOf('{{onePairingNotice}}')).toBeLessThan(template.indexOf('type="submit"'));
  expect(lang.AGENT_GATEWAY.Pairing.OnePerUser.notice).toBe(
    'Pairing here disconnects any other browser paired as you, and ends AI access granted to that pairing.',
  );
});

it('describeState names TOKEN_REJECTED and leaves other reasons alone', async () => {
  const mod = await setup('ws://127.0.0.1:7421');
  expect(mod.describeState({ kind: 'disconnected', reason: 'TOKEN_REJECTED' })).toBe(
    'L:AGENT_GATEWAY.Link.tokenRejected',
  );
  expect(mod.describeState({ kind: 'disconnected', reason: 'PAIRING_INVALID' })).toBe(
    'L:AGENT_GATEWAY.Link.pairingInvalid',
  );
  expect(mod.describeState({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' })).toBe(
    'L:AGENT_GATEWAY.Link.pairingRequired',
  );
  expect(lang.AGENT_GATEWAY.Link.tokenRejected).toMatch(
    /^This browser needs pairing: its saved pairing was not accepted\./,
  );
});

it('the window shows the paired state and Unpair only for the current user, with no token in the context', async () => {
  const mod = await setup('wss://gw.example.com/link');
  const g = globalThis as any;
  g.game.i18n.format = (k: string) => k;
  for (const [paired, expected] of [
    [true, true],
    [false, false],
  ] as const) {
    vi.doMock('../../src/link/runtime.js', () => ({
      getLinkClient: () => ({
        state: { kind: 'connecting' },
        onState: () => () => undefined,
        hasStoredToken: () => paired,
        token: 'SECRET-TOKEN',
      }),
    }));
    vi.resetModules();
    const m = await import('../../src/apps/pairing/index.js');
    const App = m.createPairingApp();
    const ctx = (await new App()._prepareContext()) as { paired: boolean };
    expect(ctx.paired).toBe(expected);
    expect(JSON.stringify(ctx)).not.toContain('SECRET-TOKEN');
  }
  void mod;
  expect(template).toContain('data-action="unpair"');
  expect(template).toContain('{{#if paired}}');
  expect(lang.AGENT_GATEWAY.Pairing.Unpair.button).toBe('Unpair this browser');
});

it('the Unpair action calls the client unpair', async () => {
  const unpair = vi.fn(async () => undefined);
  await setup('wss://gw.example.com/link');
  vi.doMock('../../src/link/runtime.js', () => ({
    getLinkClient: () => ({
      unpair,
      state: { kind: 'connecting' },
      onState: () => () => undefined,
    }),
  }));
  vi.resetModules();
  const m = await import('../../src/apps/pairing/index.js');
  const App = m.createPairingApp();
  await App.onUnpair();
  expect(unpair).toHaveBeenCalledTimes(1);
});
