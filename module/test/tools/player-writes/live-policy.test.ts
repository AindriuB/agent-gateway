import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_MATRIX } from '../../../src/policy/matrix.js';
import { DEFAULT_LIMITS } from '../../../src/ratelimit/config.js';
import { readNativeWritePolicy } from './live-policy.js';

const envelope = () => ({
  version: 1,
  world: structuredClone(DEFAULT_WORLD_MATRIX),
  playerEnabled: true,
  headlessEnabled: false,
  folders: { playerAgents: ['folder'], gmAgents: [] },
  limits: structuredClone(DEFAULT_LIMITS),
});

describe('actual native harness world policy preflight parser', () => {
  it.each([false, true])('reads a valid legacy matrix (serialized: %s)', (serialized) => {
    expect(
      readNativeWritePolicy(
        serialized ? JSON.stringify(DEFAULT_WORLD_MATRIX) : DEFAULT_WORLD_MATRIX,
      ),
    ).toEqual({ gm: 'ask_owner', player: 'ask_owner' });
  });
  it.each([false, true])('reads the migrated envelope world (serialized: %s)', (serialized) => {
    const value = envelope();
    value.world.gmAgents.write = 'ask_gm';
    value.world.playerAgents.write = 'deny';
    expect(readNativeWritePolicy(serialized ? JSON.stringify(value) : value)).toEqual({
      gm: 'ask_gm',
      player: 'deny',
    });
  });
  it.each([
    null,
    [],
    'broken JSON',
    1,
    {},
    { ...envelope(), version: 2 },
    { ...envelope(), world: undefined },
    { ...envelope(), limits: { ...DEFAULT_LIMITS, agents: 'damaged' } },
    { ...envelope(), playerEnabled: 'true' },
    { ...envelope(), folders: { playerAgents: 'folder', gmAgents: [] } },
    { world: DEFAULT_WORLD_MATRIX },
    { playerAgents: DEFAULT_WORLD_MATRIX.playerAgents },
    {
      ...DEFAULT_WORLD_MATRIX,
      gmAgents: { ...DEFAULT_WORLD_MATRIX.gmAgents, write: ['ask_owner'] },
    },
    { ...DEFAULT_WORLD_MATRIX, gmAgents: { ...DEFAULT_WORLD_MATRIX.gmAgents, extra: 'allow' } },
  ])('rejects malformed or unknown policy %j before native fixture writes', (raw) => {
    expect(() => readNativeWritePolicy(raw)).toThrow();
  });
  it('rejects an envelope mixed with legacy top-level class rows', () => {
    expect(() => readNativeWritePolicy({ ...envelope(), ...DEFAULT_WORLD_MATRIX })).toThrow();
  });
});
