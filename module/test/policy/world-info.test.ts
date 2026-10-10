// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { registerPolicySettings } from '../../src/policy/store.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { gmUser, playerUser, setupWorld } from '../stubs/world.js';
import { englishI18n, setSetting } from './helpers.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const agent = { id: 'a1', ownerUserId: 'p1', headless: false };
const info = async (user: { id: string; isGM: boolean }) =>
  ((await dispatch({ tool: 'world_info', args: {}, agent, sessionId: 's' }, user)) as any)
    .structured.activeScene;

const heroes = { id: 'heroes', name: 'Heroes' };
const elves = { id: 'elves', name: 'Elves', folder: heroes };

function world(folder: any, allow?: object) {
  stub = setupWorld({ activeScene: { documentName: 'Scene', name: 'Tavern', folder } as any });
  (globalThis as any).game.i18n = englishI18n;
  registerPolicySettings();
  return allow ? setSetting('folderAllowlist', JSON.stringify(allow)) : Promise.resolve();
}

describe('world_info with a folder allowlist', () => {
  it('names the active scene with no allowlist', async () => {
    await world(undefined);
    expect(await info(playerUser)).toBe('Tavern');
  });

  it('omits a scene outside the list, like no active scene', async () => {
    await world(elves, { playerAgents: ['villains'] });
    expect(await info(playerUser)).toBe('');
    // A scene with no folder is outside a non-empty list too.
    await world(undefined, { playerAgents: ['villains'] });
    expect(await info(playerUser)).toBe('');
  });

  it('names a scene in a listed folder or subfolder', async () => {
    await world(elves, { playerAgents: ['heroes'] });
    expect(await info(playerUser)).toBe('Tavern');
  });

  it('uses the list of the caller class', async () => {
    await world(elves, { playerAgents: ['villains'], gmAgents: ['heroes'] });
    expect(await info(playerUser)).toBe('');
    expect(await info(gmUser)).toBe('Tavern');
  });
});
