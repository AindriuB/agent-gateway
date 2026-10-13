import { describe, expect, it } from 'vitest';
import { compendiumImport } from '../../src/tools/compendium-import.js';
import { conservativeProblems } from '../../src/tools/rules.js';

const { input, output } = compendiumImport;
const uuid = 'Compendium.pf2e.equipment-srd.Item.abc';
const ok = (v: unknown) => input.safeParse(v).success;

describe('compendium_import schema', () => {
  it('keeps the world-import form', () => {
    expect(ok({ uuid })).toBe(true);
    expect(ok({ uuid, folder: 'f' })).toBe(true);
  });
  it('bounds actorUuid', () => {
    expect(ok({ uuid, actorUuid: 'Actor.x' })).toBe(true);
    expect(ok({ uuid, actorUuid: '' })).toBe(false);
    expect(ok({ uuid, actorUuid: 'a'.repeat(256) })).toBe(true);
    expect(ok({ uuid, actorUuid: 'a'.repeat(257) })).toBe(false);
  });
  it('bounds overrides', () => {
    const base = { uuid, actorUuid: 'Actor.x' };
    expect(ok({ ...base, overrides: {} })).toBe(true);
    expect(ok({ ...base, overrides: { quantity: 1 } })).toBe(true);
    expect(ok({ ...base, overrides: { quantity: 9999 } })).toBe(true);
    expect(ok({ ...base, overrides: { quantity: 0 } })).toBe(false);
    expect(ok({ ...base, overrides: { quantity: 10000 } })).toBe(false);
    expect(ok({ ...base, overrides: { quantity: 1.5 } })).toBe(false);
    expect(ok({ ...base, overrides: { equipped: true } })).toBe(true);
    expect(ok({ ...base, overrides: { equipped: 'yes' } })).toBe(false);
    expect(ok({ ...base, overrides: { slot: 'a'.repeat(100) } })).toBe(true);
    expect(ok({ ...base, overrides: { slot: 'a'.repeat(101) } })).toBe(false);
    expect(ok({ ...base, overrides: { slot: '' } })).toBe(false);
    expect(ok({ ...base, overrides: { other: 1 } })).toBe(false);
  });
  it('rejects folder with actorUuid and overrides without actorUuid', () => {
    expect(ok({ uuid, actorUuid: 'Actor.x', folder: 'f' })).toBe(false);
    expect(ok({ uuid, overrides: { quantity: 2 } })).toBe(false);
  });
  it('bounds the created output', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `Actor.x.Item.${i}`);
    expect(output.safeParse({ uuid, created: many(50) }).success).toBe(true);
    expect(output.safeParse({ uuid, created: many(51) }).success).toBe(false);
    expect(output.safeParse({ uuid, created: ['a'.repeat(501)] }).success).toBe(false);
    expect(output.safeParse({ uuid }).success).toBe(true);
  });
  it('stays conservative', () => {
    expect(conservativeProblems(compendiumImport)).toEqual([]);
  });
});
