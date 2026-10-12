import { describe, expect, it } from 'vitest';
import {
  actorSummary,
  actionsList,
  actionPerform,
  inventory,
  conditions,
  TOOLS,
  checkToolDefinition,
  toJsonSchema,
} from '../../../src/tools/index.js';
const tools = [actorSummary, actionsList, actionPerform, inventory, conditions];
describe('fixed core adapter schemas', () => {
  it.each(tools)('registers $name within conservative schema rules', (tool) => {
    expect(TOOLS.filter((t) => t.name === tool.name)).toEqual([tool]);
    expect(tool.minRole).toBe('player');
    expect(tool.handledBy).toBe('module');
    expect(
      checkToolDefinition(
        {
          ...toJsonSchema(tool),
          name: tool.name,
          description: tool.description,
          minRole: tool.minRole,
          category: tool.category,
          handledBy: tool.handledBy,
        },
        'core',
      ),
    ).toEqual([]);
    expect(tool.input.safeParse({ actorUuid: 'Actor.a', identity: 'forged' }).success).toBe(false);
  });
  it('keeps conditions canonically read and mutation values strictly bounded', () => {
    expect(conditions.category).toBe('read');
    for (const change of [
      { id: 'dead', active: true, value: -1 },
      { id: 'dead', active: true, value: 1001 },
      { id: 'dead', active: true, value: 1.5 },
      { id: 'dead', active: true, category: 'read' },
    ])
      expect(conditions.input.safeParse({ actorUuid: 'Actor.a', change }).success).toBe(false);
    expect(
      conditions.input.safeParse({
        actorUuid: 'Actor.a',
        change: { id: 'dead', active: true, value: 2 },
      }).success,
    ).toBe(true);
  });
  it('rejects unbounded or executable option envelopes', () => {
    expect(
      actionPerform.input.safeParse({
        actorUuid: 'Actor.a',
        actionId: 'attack',
        options: { user: 'gm' },
      }).success,
    ).toBe(false);
    expect(
      actionPerform.input.safeParse({
        actorUuid: 'Actor.a',
        actionId: 'attack',
        options: 'x'.repeat(8193),
      }).success,
    ).toBe(false);
    expect(
      actionsList.output.safeParse({
        actorUuid: 'Actor.a',
        systemId: 'x',
        supported: true,
        actions: Array.from({ length: 129 }, () => ({ id: 'a', name: 'a' })),
      }).success,
    ).toBe(false);
    expect(
      actorSummary.output.safeParse({
        actorUuid: 'Actor.a',
        systemId: 'x',
        name: 'a',
        img: '',
        type: 'npc',
        attributes: [],
        system: { secret: 1 },
      }).success,
    ).toBe(false);
  });
});
