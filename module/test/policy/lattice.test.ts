import { describe, expect, it } from 'vitest';
import { combine, DECISIONS, strictness } from '../../src/policy/lattice.js';
import { evaluate } from '../../src/policy/evaluate.js';
import {
  AGENT_CLASSES,
  CATEGORIES,
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  type PolicyMatrix,
} from '../../src/policy/matrix.js';

describe('decision lattice', () => {
  it('orders allow < ask_owner < ask_gm < deny', () => {
    expect(DECISIONS.map(strictness)).toEqual([0, 1, 2, 3]);
    expect([...DECISIONS]).toEqual(['allow', 'ask_owner', 'ask_gm', 'deny']);
  });

  it('combine is never less strict than the world value, over every pair', () => {
    for (const world of DECISIONS) {
      for (const owner of DECISIONS) {
        const out = combine(world, owner);
        expect(strictness(out), `${world}+${owner}`).toBeGreaterThanOrEqual(strictness(world));
        expect(strictness(out), `${world}+${owner}`).toBeGreaterThanOrEqual(strictness(owner));
        expect([world, owner]).toContain(out);
      }
    }
  });

  it('combine is the stricter, spelled out', () => {
    expect(combine('allow', 'deny')).toBe('deny');
    expect(combine('deny', 'allow')).toBe('deny');
    expect(combine('ask_gm', 'ask_owner')).toBe('ask_gm');
    expect(combine('ask_owner', 'ask_gm')).toBe('ask_gm');
    expect(combine('allow', 'allow')).toBe('allow');
  });

  const uniform = (d: (typeof DECISIONS)[number]): PolicyMatrix => ({
    playerAgents: { read: d, write: d, destructive: d, code: d },
    gmAgents: { read: d, write: d, destructive: d, code: d },
  });

  it('evaluate over every world and owner pair, class and category is never looser than the world', () => {
    for (const world of DECISIONS) {
      for (const owner of DECISIONS) {
        for (const cls of AGENT_CLASSES) {
          for (const category of CATEGORIES) {
            const v = evaluate(
              {
                world: uniform(world),
                owner: uniform(owner),
                playerAgentsEnabled: true,
                headlessAgentsEnabled: true,
              },
              { isGM: cls === 'gmAgents', headless: false, category },
            );
            if (v.kind !== 'decision') throw new Error('expected a decision');
            const floor = category === 'code' && world === 'allow' ? 'ask_owner' : world;
            expect(
              strictness(v.decision),
              `${world}/${owner}/${cls}/${category}`,
            ).toBeGreaterThanOrEqual(strictness(floor));
          }
        }
      }
    }
  });

  it('a code cell never evaluates to allow, even if both levels say allow', () => {
    const v = evaluate(
      {
        world: uniform('allow'),
        owner: uniform('allow'),
        playerAgentsEnabled: true,
        headlessAgentsEnabled: true,
      },
      { isGM: true, headless: false, category: 'code' },
    );
    expect(v).toMatchObject({ kind: 'decision', decision: 'ask_owner' });
  });

  it('the default owner matrix never loosens the default world matrix', () => {
    for (const cls of AGENT_CLASSES) {
      for (const cat of CATEGORIES) {
        expect(combine(DEFAULT_WORLD_MATRIX[cls][cat], DEFAULT_OWNER_MATRIX[cls][cat])).toBe(
          DEFAULT_WORLD_MATRIX[cls][cat],
        );
      }
    }
  });
});
