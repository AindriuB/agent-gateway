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

  describe('listChoices', () => {
    const parse = (a: unknown) => characterBuild.input.safeParse(a);
    it('takes a compendium UUID instead of an actor', () => {
      expect(parse({ listChoices: 'Compendium.pf2e.classes.Item.abc' }).success).toBe(true);
      expect(parse({ listChoices: 'a'.repeat(500) }).success).toBe(true);
      expect(parse({ listChoices: 'a'.repeat(501) }).success).toBe(false);
      expect(parse({ listChoices: '' }).success).toBe(false);
    });
    it('needs exactly one of actorUuid and listChoices and refuses changes with it', () => {
      expect(parse({}).success).toBe(false);
      expect(parse({ actorUuid: 'Actor.a', listChoices: 'Compendium.a.b.Item.c' }).success).toBe(
        false,
      );
      expect(parse({ listChoices: 'Compendium.a.b.Item.c', changes: [] }).success).toBe(false);
    });
    it('bounds the choices output', () => {
      const choice = (n: number, opts = 1) => ({
        flag: `f${n}`,
        itemUuid: 'u',
        prompt: 'p',
        options: Array.from({ length: opts }, (_, i) => ({ value: `v${i}`, label: 'l' })),
        truncated: false,
      });
      const out = (choices: unknown[]) =>
        characterBuild.output.safeParse({
          systemId: 'pf2e',
          supported: true,
          boosts: [],
          skills: [],
          featSlots: [],
          choices,
        });
      expect(out(Array.from({ length: 64 }, (_, i) => choice(i))).success).toBe(true);
      expect(out(Array.from({ length: 65 }, (_, i) => choice(i))).success).toBe(false);
      expect(out([choice(1, 50)]).success).toBe(true);
      expect(out([choice(1, 51)]).success).toBe(false);
      expect(
        out([{ ...choice(1), options: [{ value: 'v', label: 'l'.repeat(201) }] }]).success,
      ).toBe(false);
    });
  });
});
