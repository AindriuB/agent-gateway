import { describe, expect, it } from 'vitest';
import {
  validateArgs,
  TOOLS,
  toJsonSchema,
  eventsPoll,
  eventsHistory,
  conservativeProblems,
  checkToolDefinition,
  walk,
} from '../../../src/tools/index.js';

const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['count', 'name', 'items'],
  properties: {
    count: { type: 'integer', minimum: 1, maximum: 5, description: 'Count' },
    name: { type: 'string', minLength: 1, maxLength: 4, enum: ['one', 'two'], description: 'Name' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 2,
      items: { type: 'boolean' },
      description: 'Items',
    },
    defaulted: { type: 'string', default: 'hello', description: 'Default field' },
  },
};
const valid = { count: 2, name: 'one', items: [true] };

describe('validateArgs', () => {
  it('accepts valid input and applies defaults', () =>
    expect(validateArgs(schema, valid)).toEqual({
      ok: true,
      value: { ...valid, defaulted: 'hello' },
    }));
  it.each([
    { name: 'one', items: [true] },
    { ...valid, extra: 1 },
    { ...valid, count: '2' },
    { ...valid, count: 1.5 },
    { ...valid, count: 0 },
    { ...valid, count: 6 },
    { ...valid, name: 'longer' },
    { ...valid, name: '' },
    { ...valid, name: 'bad' },
    { ...valid, items: [true, false, true] },
    { ...valid, items: [] },
    { ...valid, items: ['true'] },
  ])('rejects invalid input %j', (value) => expect(validateArgs(schema, value).ok).toBe(false));
  it('does not mutate frozen input', () => {
    const input = Object.freeze({ ...valid });
    expect(validateArgs(schema, input).ok).toBe(true);
    expect(Object.hasOwn(input, 'defaulted')).toBe(false);
  });
  it('returns issues for malformed required on a primitive', () => {
    const malformed = {
      type: 'object',
      additionalProperties: false,
      properties: { x: { type: 'string', description: 'X', required: 42 } },
    };
    expect(validateArgs(malformed, { x: 'hello' })).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('required') }],
    });
  });
  it('returns issues for a function default', () => {
    const malformed = {
      type: 'object',
      additionalProperties: false,
      properties: { x: { type: 'string', description: 'X', default: () => 1 } },
    };
    expect(validateArgs(malformed, {})).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('default') }],
    });
  });
  it('returns issues instead of throwing on an unreadable input', () => {
    const input = Object.defineProperty({}, 'count', {
      enumerable: true,
      get: () => {
        throw new Error('Unreadable');
      },
    });
    expect(validateArgs(schema, input)).toMatchObject({
      ok: false,
      issues: [{ message: expect.stringContaining('JSON') }],
    });
  });
  it('does not apply nested defaults', () => {
    const nested = {
      type: 'object',
      additionalProperties: false,
      properties: {
        child: {
          type: 'object',
          additionalProperties: false,
          description: 'Child',
          properties: { value: { type: 'string', default: 'hello', description: 'Value' } },
        },
      },
    };
    expect(validateArgs(nested, { child: {} })).toEqual({ ok: true, value: { child: {} } });
  });
  it('handles exclusive bounds and null', () => {
    const s = {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 2, description: 'X' },
        n: { type: 'null', description: 'Null' },
      },
    };
    expect([
      validateArgs(s, { x: 1, n: null }).ok,
      validateArgs(s, { x: 0 }).ok,
      validateArgs(s, { x: 2 }).ok,
    ]).toEqual([true, false, false]);
  });
  it('counts Unicode codepoints for length', () =>
    expect(
      validateArgs(
        {
          type: 'object',
          additionalProperties: false,
          properties: { x: { type: 'string', maxLength: 1, description: 'X' } },
        },
        { x: '😀' },
      ).ok,
    ).toBe(true));
  it('rejects invalid schemas rather than ignoring unsupported rules', () =>
    expect(validateArgs({ ...schema, pattern: '.*' }, valid).ok).toBe(false));
  const examples: Record<string, unknown> = {
    actor_summary: { actorUuid: 'Actor.example' },
    actions_list: { actorUuid: 'Actor.example' },
    action_perform: { actorUuid: 'Actor.example', actionId: 'attack' },
    inventory: { actorUuid: 'Actor.example' },
    conditions: { actorUuid: 'Actor.example' },
    character_build: { actorUuid: 'Actor.example' },
    macro_run: { macroUuid: 'Macro.example' },
    script_run: { source: 'return 1;' },
    table_roll: { tableUuid: 'RollTable.example' },
    playlist_control: { playlistUuid: 'Playlist.example', action: 'play' },
    notify: { message: 'Hello' },
    document_create: { type: 'Actor', data: '{"name":"Test"}' },
    document_update: { uuid: 'Actor.example', update: '{"name":"Test"}' },
    document_delete: { uuids: ['Actor.example'] },
    token_manage: { action: 'hide', tokenUuid: 'Scene.example.Token.example' },
    combat_manage: { action: 'next_turn', combatUuid: 'Combat.example' },
    scene_control: { action: 'view', sceneUuid: 'Scene.example' },
    compendium_import: { uuid: 'Compendium.test.actors.Actor.example' },
    token_move: { tokenUuid: 'Scene.example.Token.example', x: 1, y: 1 },
    target_set: { tokenUuids: [], mode: 'clear' },
    combat_status: {},
    combat_end_turn: {
      combatUuid: 'Combat.example',
      currentCombatantUuid: 'Combat.example.Combatant.example',
      round: 1,
      turn: 0,
    },
    events_poll: {},
    events_history: { since: '2026-01-01T00:00:00Z' },
    world_info: {},
    document_search: { type: 'Actor' },
    document_get: { uuid: 'Actor.example' },
    compendium_search: { query: 'test' },
    compendium_get: { uuid: 'Compendium.test.abc' },
    chat_read: {},
    approval_status: { id: 'abc' },
    chat_post: { content: 'Hello' },
    roll_formula: { formula: '1d6' },
    journal_write: { journalUuid: 'JournalEntry.example', title: 'Test', markdown: 'Hello' },
    image_upload: { data: 'iVBORw0KGgo=', mime: 'image/png' },
  };
  it.each(TOOLS.map((t) => [t.name, t] as const))('agrees with zod for %s', (name, tool) => {
    const value = examples[name];
    expect(tool.input.safeParse(value).success).toBe(true);
    expect(validateArgs(toJsonSchema(tool).inputSchema, value).ok).toBe(true);
    const extra = { ...(value as object), unexpected: 1 };
    expect([
      tool.input.safeParse(extra).success,
      validateArgs(toJsonSchema(tool).inputSchema, extra).ok,
    ]).toEqual([false, false]);
  });
  it('checks a fast sample of depth 3 object arrays', () => {
    const s = {
      type: 'object',
      additionalProperties: false,
      properties: {
        rows: {
          type: 'array',
          description: 'Rows',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              inner: {
                type: 'object',
                additionalProperties: false,
                description: 'Inner',
                properties: { value: { type: 'number', description: 'Value' } },
              },
            },
          },
        },
      },
    };
    expect(
      validateArgs(s, { rows: Array.from({ length: 100 }, () => ({ inner: { value: 1 } })) }).ok,
    ).toBe(true);
  });
});

describe('static gateway event output schema boundary', () => {
  it('admits only the two actual static definitions through the trusted output path', () => {
    for (const tool of [eventsPoll, eventsHistory]) {
      expect(conservativeProblems(tool)).toEqual([]);
      expect(conservativeProblems({ ...tool })).not.toEqual([]);
      const announced = { ...tool, ...toJsonSchema(tool) };
      expect(checkToolDefinition(announced, 'core')).not.toEqual([]);
      expect(checkToolDefinition(announced, 'pack')).not.toEqual([]);
      const errors: string[] = [];
      walk(announced.outputSchema, 0, 'output', errors, {
        root: announced.outputSchema,
        chain: [],
        trustedOutput: true,
      });
      expect(errors).not.toEqual([]);
    }
  });
  it('keeps the static definitions immutable and refuses equivalent impostor input unions', () => {
    expect(Object.isFrozen(eventsPoll)).toBe(true);
    expect(conservativeProblems({ ...eventsPoll, input: eventsHistory.output })).not.toEqual([]);
  });
});
