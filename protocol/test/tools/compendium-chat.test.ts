/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { TOOLS, toJsonSchema } from '../../src/tools/index.js';

const NAMES = ['compendium_search', 'compendium_get', 'chat_read'];
const byName = (n: string) => TOOLS.find((t) => t.name === n)!;

describe('compendium and chat read tools', () => {
  it.each(NAMES)('%s is a player-level module read tool', (n) => {
    expect(byName(n)).toMatchObject({ minRole: 'player', category: 'read', handledBy: 'module' });
  });

  it('compendium_search validates args', () => {
    const { input } = byName('compendium_search');
    expect(input.parse({ query: 'a' })).toEqual({ query: 'a', limit: 20 });
    expect(input.safeParse({ query: 'a', limit: 51 }).success).toBe(false);
    expect(input.safeParse({ query: 'a', limit: 0 }).success).toBe(false);
    expect(input.safeParse({ query: 'a', packType: 'Cards' }).success).toBe(false);
    expect(input.safeParse({ query: 'a', packType: 'RollTable', pack: 'w.p' }).success).toBe(true);
    expect(input.safeParse({ query: 'a', extra: 1 }).success).toBe(false);
  });

  it('compendium_get validates args', () => {
    const { input } = byName('compendium_get');
    expect(input.safeParse({ uuid: 'Compendium.w.p.Item.x', cursor: 'c' }).success).toBe(true);
    expect(input.safeParse({}).success).toBe(false);
  });

  it('chat_read validates args', () => {
    const { input } = byName('chat_read');
    expect(input.parse({})).toEqual({ limit: 20 });
    expect(input.safeParse({ limit: 100, before: 'x' }).success).toBe(true);
    expect(input.safeParse({ limit: 101 }).success).toBe(false);
  });

  it('chat_read documents aiAuthored as advisory and forgeable', () => {
    const { outputSchema } = toJsonSchema(byName('chat_read'));
    const messages = (outputSchema.properties as any).messages.items.properties;
    expect(messages.aiAuthored.description).toMatch(/advisory/i);
    expect(messages.aiAuthored.description).toMatch(/forged/i);
  });

  it.each(NAMES)('%s has JSON schemas with no required cursor or defaults leaking', (n) => {
    const { inputSchema, outputSchema } = toJsonSchema(byName(n));
    expect(inputSchema.additionalProperties).toBe(false);
    expect(outputSchema.additionalProperties).toBe(false);
  });
});
