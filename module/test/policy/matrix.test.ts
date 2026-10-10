/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  loadMatrix,
  PolicyError,
  validateMatrix,
} from '../../src/policy/matrix.js';
import {
  headlessAgentsEnabled,
  loadOwnerPolicy,
  loadWorldPolicy,
  playerAgentsEnabled,
  registerPolicySettings,
  saveOwnerPolicy,
  saveWorldPolicy,
} from '../../src/policy/store.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { setSetting } from './helpers.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const fresh = () => {
  stub = installFoundry(14);
  registerPolicySettings();
};
const withCode = (code: string) => ({
  playerAgents: { ...DEFAULT_WORLD_MATRIX.playerAgents, code },
  gmAgents: { ...DEFAULT_WORLD_MATRIX.gmAgents, code },
});

describe('defaults', () => {
  it('world matrix matches the spec', () => {
    expect(DEFAULT_WORLD_MATRIX).toEqual({
      playerAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_gm', code: 'ask_gm' },
      gmAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_owner', code: 'ask_owner' },
    });
  });

  it('a fresh world loads the defaults and both toggles are off', () => {
    fresh();
    // The stub pre-enables player agents for the tool tests; a real fresh world has the default.
    expect(stub.registeredSettings.get('agent-gateway.playerAgentsEnabled')).toMatchObject({
      scope: 'world',
      default: false,
      type: Boolean,
    });
    expect(stub.registeredSettings.get('agent-gateway.headlessAgentsEnabled')).toMatchObject({
      scope: 'world',
      default: false,
      type: Boolean,
    });
    expect(headlessAgentsEnabled()).toBe(false);
    expect(loadWorldPolicy()).toEqual(DEFAULT_WORLD_MATRIX);
    expect(loadOwnerPolicy()).toEqual(DEFAULT_OWNER_MATRIX);
  });

  it('policy settings have the right scopes, and the world ones are GM-restricted', () => {
    fresh();
    const s = stub.registeredSettings;
    expect(s.get('agent-gateway.worldPolicy')).toMatchObject({ scope: 'world', restricted: true });
    expect(s.get('agent-gateway.ownerPolicy')).toMatchObject({ scope: 'client' });
    expect(s.get('agent-gateway.playerAgentsEnabled')).toMatchObject({ restricted: true });
    expect(s.get('agent-gateway.headlessAgentsEnabled')).toMatchObject({ restricted: true });
  });

  it('toggles read true only for a stored true', async () => {
    fresh();
    await setSetting('playerAgentsEnabled', 'true');
    expect(playerAgentsEnabled()).toBe(false);
    await setSetting('playerAgentsEnabled', true);
    expect(playerAgentsEnabled()).toBe(true);
  });
});

describe('code can never be allow', () => {
  it('validate (save) rejects allow in either class', () => {
    const bad = withCode('allow');
    expect(() => validateMatrix(bad)).toThrow(PolicyError);
    const onlyGm = withCode('ask_gm') as any;
    onlyGm.gmAgents.code = 'allow';
    expect(() => validateMatrix(onlyGm)).toThrow(/gmAgents\.code/);
    const onlyPlayer = withCode('ask_gm') as any;
    onlyPlayer.playerAgents.code = 'allow';
    expect(() => validateMatrix(onlyPlayer)).toThrow(/playerAgents\.code/);
  });

  it('saving at world and owner level rejects allow and stores nothing', async () => {
    fresh();
    await expect(saveWorldPolicy(withCode('allow'))).rejects.toThrow(PolicyError);
    await expect(saveOwnerPolicy(withCode('allow'))).rejects.toThrow(PolicyError);
    expect(loadWorldPolicy()).toEqual(DEFAULT_WORLD_MATRIX);
    expect(loadOwnerPolicy()).toEqual(DEFAULT_OWNER_MATRIX);
  });

  it('saving a valid matrix round-trips', async () => {
    fresh();
    const m = withCode('deny');
    await saveWorldPolicy(m);
    await saveOwnerPolicy(m);
    expect(loadWorldPolicy()).toEqual(m);
    expect(loadOwnerPolicy()).toEqual(m);
  });

  it('load coerces a stored allow to ask_owner at both levels (even for player agents)', async () => {
    fresh();
    await setSetting('worldPolicy', JSON.stringify(withCode('allow')));
    await setSetting('ownerPolicy', JSON.stringify(withCode('allow')));
    expect(loadWorldPolicy().playerAgents.code).toBe('ask_owner');
    expect(loadWorldPolicy().gmAgents.code).toBe('ask_owner');
    expect(loadOwnerPolicy().playerAgents.code).toBe('ask_owner');
    expect(loadOwnerPolicy().gmAgents.code).toBe('ask_owner');
  });

  it('load keeps other allow cells and takes defaults for invalid cells', () => {
    const m = loadMatrix(
      JSON.stringify({ playerAgents: { read: 'allow', write: 'bogus', code: 'deny' } }),
      DEFAULT_WORLD_MATRIX,
    );
    expect(m.playerAgents).toEqual({
      read: 'allow',
      write: 'ask_owner',
      destructive: 'ask_gm',
      code: 'deny',
    });
    expect(m.gmAgents).toEqual(DEFAULT_WORLD_MATRIX.gmAgents);
    expect(loadMatrix('not json', DEFAULT_WORLD_MATRIX)).toEqual(DEFAULT_WORLD_MATRIX);
    expect(loadMatrix(undefined, DEFAULT_WORLD_MATRIX)).toEqual(DEFAULT_WORLD_MATRIX);
  });

  it('validate rejects missing classes and invalid decisions', () => {
    expect(() => validateMatrix(null)).toThrow(PolicyError);
    expect(() => validateMatrix({ playerAgents: DEFAULT_WORLD_MATRIX.playerAgents })).toThrow(
      /gmAgents/,
    );
    const m = withCode('deny') as any;
    m.gmAgents.write = 'sometimes';
    expect(() => validateMatrix(m)).toThrow(/gmAgents\.write/);
  });
});
