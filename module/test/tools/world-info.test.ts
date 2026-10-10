// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { expectInertSpan, HOSTILE_NAMES } from '../stubs/inert.js';
import { gmUser, playerUser, setupWorld } from '../stubs/world.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const agent = { id: 'a1', ownerUserId: 'p1', headless: false };
const run = (user: { id: string; isGM: boolean }) =>
  dispatch({ tool: 'world_info', args: {}, agent, sessionId: 's' }, user);

describe('world_info', () => {
  it('reports world, system, generation, user, scene and combat', async () => {
    stub = setupWorld({ activeScene: { name: 'Tavern' }, combatActive: true });
    const r = await run(playerUser);
    expect(r).toMatchObject({
      structured: {
        worldId: 'my-world',
        worldTitle: 'My World',
        systemId: 'dnd5e',
        systemVersion: '5.1.0',
        foundryGeneration: 14,
        userName: 'Pat',
        userRole: 'PLAYER',
        activeScene: 'Tavern',
        combatActive: true,
      },
    });
    expect('text' in r && r.text).toContain('Tavern');
  });
  it('reports the calling user, no scene and no combat', async () => {
    stub = setupWorld();
    const r = await run(gmUser);
    expect(r).toMatchObject({
      structured: {
        userName: 'Gamemaster',
        userRole: 'GAMEMASTER',
        activeScene: '',
        combatActive: false,
      },
    });
  });
  it('rejects arguments', async () => {
    stub = setupWorld();
    const r = await dispatch(
      { tool: 'world_info', args: { x: 1 }, agent, sessionId: 's' },
      playerUser,
    );
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
  it('players get the scene navigation name, the GM the real name', async () => {
    stub = setupWorld({ activeScene: { name: 'Secret Lair Plans', navName: 'Cellar' } });
    expect(await run(playerUser)).toMatchObject({ structured: { activeScene: 'Cellar' } });
    expect(await run(gmUser)).toMatchObject({ structured: { activeScene: 'Secret Lair Plans' } });
    stub.uninstall();
    stub = setupWorld({ activeScene: { name: 'Plain' } });
    expect(await run(playerUser)).toMatchObject({ structured: { activeScene: 'Plain' } });
  });
  it.each(HOSTILE_NAMES)('escapes names in the text: %j', async (name) => {
    stub = setupWorld({ activeScene: { name } });
    (globalThis as any).game.world.title = name;
    (globalThis as any).game.users.get('p1').name = name;
    const r = await run(playerUser);
    const t = 'text' in r ? r.text : '';
    expect(t.split('\n')).toHaveLength(1);
    expectInertSpan(t);
    playerUser.name = 'Pat';
  });
});
