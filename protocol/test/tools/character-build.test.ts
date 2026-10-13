import { describe, expect, it } from 'vitest';
import {
  characterBuild,
  checkToolDefinition,
  toJsonSchema,
  toolsForRole,
} from '../../src/tools/index.js';

describe('character_build schema', () => {
  it('is a player-visible module read tool within conservative schema rules', () => {
    expect(characterBuild).toMatchObject({
      minRole: 'player',
      category: 'read',
      handledBy: 'module',
    });
    expect(toolsForRole(false).map((t) => t.name)).toContain('character_build');
    expect(
      checkToolDefinition(
        {
          ...toJsonSchema(characterBuild),
          name: characterBuild.name,
          description: characterBuild.description,
          minRole: characterBuild.minRole,
          category: characterBuild.category,
          handledBy: characterBuild.handledBy,
        },
        'core',
      ),
    ).toEqual([]);
  });
  const ok = (a: unknown) =>
    characterBuild.input.safeParse({ actorUuid: 'Actor.a', ...(a as object) });
  it('accepts a bounded batch and a bare read', () => {
    expect(ok({}).success).toBe(true);
    expect(
      ok({
        changes: [
          { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'str' },
          { kind: 'skill_rank', skill: 'acrobatics', rank: 2 },
          { kind: 'feat_slot', slot: 'class-1', itemUuid: 'Actor.a.Item.b' },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    [{ kind: 'nope' }],
    [{ kind: 'skill_rank', rank: 5 }],
    [{ kind: 'skill_rank', rank: 1.5 }],
    [{ kind: 'attribute_boost', level: 21 }],
    [{ kind: 'attribute_boost', level: 0 }],
    [{ kind: 'attribute_boost', attribute: 'x'.repeat(33) }],
    [{ kind: 'skill_rank', skill: 'x'.repeat(65) }],
    [{ kind: 'feat_slot', slot: 'x'.repeat(101) }],
    [{ kind: 'feat_slot', itemUuid: 'x'.repeat(257) }],
    [{ kind: 'skill_rank', extra: true }],
  ])('rejects out-of-bounds change %j', (change) =>
    expect(ok({ changes: [change] }).success).toBe(false),
  );
  it('caps the batch at 32 changes and rejects extra keys', () => {
    const change = { kind: 'skill_rank', skill: 'a', rank: 1 };
    expect(ok({ changes: Array(32).fill(change) }).success).toBe(true);
    expect(ok({ changes: Array(33).fill(change) }).success).toBe(false);
    expect(ok({ identity: 'forged' }).success).toBe(false);
  });
  it('bounds the output', () => {
    const base = {
      actorUuid: 'Actor.a',
      systemId: 'pf2e',
      supported: true,
      boosts: [],
      skills: [],
      featSlots: [],
    };
    expect(characterBuild.output.safeParse(base).success).toBe(true);
    expect(
      characterBuild.output.safeParse({ ...base, skills: Array(129).fill({ skill: 'a', rank: 1 }) })
        .success,
    ).toBe(false);
    expect(characterBuild.output.safeParse({ ...base, message: 'x'.repeat(2001) }).success).toBe(
      false,
    );
  });
});
