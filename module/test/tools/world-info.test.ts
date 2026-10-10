// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { gmUser, playerUser, setupWorld } from './fixtures.js';

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
});
