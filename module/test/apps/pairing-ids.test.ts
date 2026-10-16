/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  vi.unstubAllGlobals();
  vi.doUnmock('../../src/link/runtime.js');
});

const lang = JSON.parse(readFileSync(resolve(__dirname, '../../../lang/en.json'), 'utf8')) as any;
const template = readFileSync(resolve(__dirname, '../../../templates/pairing/pairing.hbs'), 'utf8');

async function setup() {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  const strings: Record<string, string> = {
    'AGENT_GATEWAY.Pairing.CopyIds.label': lang.AGENT_GATEWAY.Pairing.CopyIds.label,
  };
  g.game.i18n = {
    localize: (k: string) => `L:${k}`,
    format: (k: string, d: Record<string, string>) =>
      (strings[k] ?? k).replace(/\{(\w+)\}/g, (_m, n: string) => d[n] ?? ''),
  };
  g.game.world = { id: 'my-world' };
  g.game.user = { id: 'UserId0123456789' };
  g.game.settings.get = () => 'ws://gw';
  const notify = { info: vi.fn(), warn: vi.fn() };
  g.ui = { notifications: notify };
  vi.doMock('../../src/link/runtime.js', () => ({
    getLinkClient: () => ({ state: { kind: 'connecting' }, onState: () => () => undefined }),
  }));
  const mod = await import('../../src/apps/pairing/index.js');
  return { mod, notify };
}

it('shows this browser world id and user id', async () => {
  const { mod } = await setup();
  const App = mod.createPairingApp();
  const ctx = (await new App()._prepareContext()) as { idsText: string };
  expect(ctx.idsText).toBe('Your ids: world my-world, user UserId0123456789');
});

it('the copy button copies "<world id> <user id>" and says so', async () => {
  const { mod, notify } = await setup();
  const writeText = vi.fn(async () => undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const App = mod.createPairingApp();
  expect(App.DEFAULT_OPTIONS.actions.copyIds).toBe(App.onCopyIds);
  await App.onCopyIds();
  expect(writeText).toHaveBeenCalledWith('my-world UserId0123456789');
  expect(notify.info).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.CopyIds.copied');
});

it('warns when the clipboard is unavailable', async () => {
  const { mod, notify } = await setup();
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: async () => {
        throw new Error('denied');
      },
    },
  });
  await mod.createPairingApp().onCopyIds();
  expect(notify.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.CopyIds.failed');
});

it('the template wires the line and the button, and every string is localized', () => {
  expect(template).toContain('{{idsText}}');
  expect(template).toContain('data-action="copyIds"');
  expect(template).toMatch(/<details[^>]*>\s*<summary>[\s\S]*data-role="ids"[\s\S]*<\/details>/);
  expect(template).toContain('{{idsHint}}');
  const used = [...template.matchAll(/localize "(AGENT_GATEWAY\.Pairing\.CopyIds\.\w+)"/g)].map(
    (m) => m[1]!,
  );
  expect(used.length).toBeGreaterThanOrEqual(2);
  for (const key of [
    ...used,
    'AGENT_GATEWAY.Pairing.CopyIds.copied',
    'AGENT_GATEWAY.Pairing.CopyIds.playerHint',
    'AGENT_GATEWAY.Pairing.CopyIds.hint',
    'AGENT_GATEWAY.Pairing.CopyIds.failed',
  ]) {
    const v = key.split('.').reduce((o: any, k) => o?.[k], lang);
    expect(typeof v, key).toBe('string');
  }
});
