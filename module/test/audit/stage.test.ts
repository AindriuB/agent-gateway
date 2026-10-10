import { defineTool } from '@agent-gateway/protocol';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AUDIT_STAGE_ORDER, createAuditStage } from '../../src/audit/stage.js';
import { AUDIT_LIMITS } from '../../src/audit/types.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import type { Stage } from '../../src/ops/stages.js';
import type { OpCall, OpContext } from '../../src/ops/types.js';
import { makeStore, writable } from './fake.js';

const tool = (name: string, category: 'read' | 'write' | 'destructive' | 'code') =>
  defineTool({
    name,
    minRole: 'player',
    category,
    handledBy: 'module',
    description: 'x',
    input: z.strictObject({ uuid: z.string().optional(), blob: z.unknown().optional() }),
    output: z.strictObject({}),
  });
const tools = [
  tool('fixture_read', 'read'),
  tool('fixture_write', 'write'),
  tool('fixture_delete', 'destructive'),
  tool('fixture_code', 'code'),
];
const agent = { id: 'agent-1', ownerUserId: 'p1', headless: false };
const player = { id: 'p1', isGM: false };
const call = (name: string, args: unknown = {}): OpCall => ({
  tool: name,
  args,
  agent,
  sessionId: 's',
});

function rig(opts: { stages?: Stage[]; submit?: (r: AuditRecord) => Promise<void> } = {}) {
  const store = makeStore();
  const records: AuditRecord[] = [];
  const stage = createAuditStage({
    categoryOf: (t) => tools.find((x) => x.name === t)?.category,
    fromUuid: store.fromUuid,
    submit: opts.submit ?? (async (r) => void records.push(r)),
    now: () => 5000,
    newId: () => 'entry-abcdef01',
  });
  const handlers: Record<
    string,
    (ctx: OpContext) => Promise<{ text: string; structured: object }>
  > = {
    fixture_read: async () => ({ text: 'read ok', structured: {} }),
    fixture_write: async (ctx) => {
      const { uuid } = ctx.args as { uuid: string };
      await ctx.snapshot?.(uuid);
      const doc = store.docs.get(uuid);
      doc.data.name = 'New';
      doc._stats.modifiedTime = 99;
      return { text: 'renamed\nsecond line', structured: {} };
    },
    fixture_delete: async (ctx) => {
      const { uuid } = ctx.args as { uuid: string };
      await ctx.snapshot?.(uuid);
      store.docs.delete(uuid);
      return { text: 'deleted', structured: {} };
    },
    fixture_code: async (ctx) => {
      const uuid = 'Item.new1';
      store.add(writable(uuid, { name: 'Made' }, 7));
      await ctx.created?.(uuid);
      return { text: 'created', structured: {} };
    },
  };
  const dispatch = createDispatcher({ tools, handlers, stages: [...(opts.stages ?? []), stage] });
  return { store, records, dispatch };
}

describe('audit stage', () => {
  it('runs at order 40, after approval (30) and rate limits (25)', () => {
    expect(AUDIT_STAGE_ORDER).toBe(40);
    expect(createAuditStage().order).toBe(40);
  });

  it('does not record reads, and gives them no snapshot function', async () => {
    const { records, dispatch } = rig();
    let seen: OpContext | undefined;
    const spy: Stage = { name: 'spy', order: 100, run: (c, n) => ((seen = c), n()) };
    const r = rig({ stages: [spy] });
    expect(await r.dispatch(call('fixture_read'), player)).toMatchObject({ text: 'read ok' });
    expect(r.records).toEqual([]);
    expect(seen?.snapshot).toBeUndefined();
    await dispatch(call('fixture_read'), player);
    expect(records).toEqual([]);
  });

  it('records a write with who, agent, tool, args and the before snapshot', async () => {
    const { store, records, dispatch } = rig();
    store.add(writable('Actor.a1', { name: 'Old' }, 3));
    await dispatch(call('fixture_write', { uuid: 'Actor.a1' }), player);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      entryId: 'entry-abcdef01',
      timestamp: 5000,
      userId: 'p1',
      agentId: 'agent-1',
      tool: 'fixture_write',
      category: 'write',
      args: '{"uuid":"Actor.a1"}',
      result: 'renamed',
      status: 'ok',
      relayed: false,
    });
    expect(records[0]!.targets).toEqual([
      {
        uuid: 'Actor.a1',
        existed: true,
        before: expect.objectContaining({ name: 'Old' }),
        existsAfter: true,
        afterModifiedTime: 99,
        undoable: true,
        note: '',
      },
    ]);
  });

  it('records destructive calls (target gone afterwards) and code calls (created target)', async () => {
    const { store, records, dispatch } = rig();
    store.add(writable('Actor.a2', { name: 'Doomed' }, 3));
    await dispatch(call('fixture_delete', { uuid: 'Actor.a2' }), player);
    await dispatch(call('fixture_code'), player);
    expect(records.map((r) => r.category)).toEqual(['destructive', 'code']);
    expect(records[0]!.targets[0]).toMatchObject({
      existed: true,
      existsAfter: false,
      afterModifiedTime: null,
    });
    expect(records[1]!.targets[0]).toMatchObject({
      uuid: 'Item.new1',
      existed: false,
      before: null,
      existsAfter: true,
      afterModifiedTime: 7,
    });
  });

  it('is not reached when an earlier stage (approval) denies the call', async () => {
    const deny: Stage = {
      name: 'approval',
      order: 30,
      run: async () => ({ error: { code: 'DENIED', message: 'no' } }),
    };
    const { records, dispatch } = rig({ stages: [deny] });
    await dispatch(call('fixture_write', { uuid: 'Actor.a1' }), player);
    expect(records).toEqual([]);
  });

  it('records a handler error result and a thrown handler, and keeps the first snapshot of a uuid', async () => {
    const store = makeStore();
    store.add(writable('Actor.a1', { name: 'Old' }, 3));
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      categoryOf: () => 'write',
      fromUuid: store.fromUuid,
      submit: async (r) => void records.push(r),
    });
    const d = createDispatcher({
      tools,
      handlers: {
        fixture_write: async (ctx) => {
          await ctx.snapshot?.('Actor.a1');
          store.docs.get('Actor.a1').data.name = 'Changed';
          await ctx.snapshot?.('Actor.a1');
          return { error: { code: 'INVALID_ARGS', message: 'bad thing' } };
        },
        fixture_delete: async (ctx) => {
          await ctx.snapshot?.('Actor.a1');
          throw new Error('boom');
        },
      },
      stages: [stage],
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await d(call('fixture_write', {}), player);
    expect(records[0]).toMatchObject({ status: 'error', result: 'INVALID_ARGS: bad thing' });
    expect(records[0]!.targets).toHaveLength(1);
    expect((records[0]!.targets[0]!.before as { name: string }).name).toBe('Old');
    expect(await d(call('fixture_delete', {}), player)).toMatchObject({
      error: { code: 'INTERNAL' },
    });
    expect(records[1]).toMatchObject({ status: 'error', result: 'the handler threw' });
  });

  it('bounds hostile args: huge strings, deep nesting, wide objects, throwing getters', async () => {
    const { records, dispatch } = rig();
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 5000; i++) deep = (deep.n = {}) as Record<string, unknown>;
    const wide = Object.fromEntries(Array.from({ length: 20000 }, (_, i) => [`k${i}`, 'v']));
    for (const blob of [
      'x'.repeat(5_000_000),
      root,
      wide,
      Array(100000).fill('y'),
      '<img src=x onerror=alert(1)>',
    ]) {
      await dispatch(call('fixture_code', { blob }), player);
    }
    expect(records).toHaveLength(5);
    for (const r of records) expect(r.args.length).toBeLessThanOrEqual(AUDIT_LIMITS.argsChars + 3);
    expect(records[0]!.argsTruncated).toBe(true);
    expect(records[1]!.argsTruncated).toBe(true);
    expect(records[2]!.argsTruncated).toBe(true);
    expect(records[4]!.argsTruncated).toBe(false);
  });

  it('does not keep an oversized snapshot and marks the target not undoable', async () => {
    const { store, records, dispatch } = rig();
    store.add(writable('Actor.big', { blob: 'z'.repeat(AUDIT_LIMITS.beforeChars + 10) }, 3));
    await dispatch(call('fixture_write', { uuid: 'Actor.big' }), player);
    expect(records[0]!.targets[0]).toMatchObject({
      before: null,
      undoable: false,
      note: 'snapshot too large to keep',
    });
  });

  it('caps the number of targets and counts the rest', async () => {
    const store = makeStore();
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      categoryOf: () => 'write',
      fromUuid: store.fromUuid,
      submit: async (r) => void records.push(r),
    });
    const d = createDispatcher({
      tools,
      handlers: {
        fixture_write: async (ctx) => {
          for (let i = 0; i < 60; i++) {
            store.add(writable(`Actor.t${i}`, {}, 1));
            await ctx.snapshot?.(`Actor.t${i}`);
          }
          return { text: 'many', structured: {} };
        },
      },
      stages: [stage],
    });
    await d(call('fixture_write', {}), player);
    expect(records[0]!.targets).toHaveLength(AUDIT_LIMITS.targets);
    expect(records[0]!.targetsDropped).toBe(10);
  });

  it('never fails the call when recording fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, dispatch } = rig({
      submit: async () => {
        throw new Error('journal gone');
      },
    });
    store.add(writable('Actor.a1', { name: 'Old' }, 3));
    expect(await dispatch(call('fixture_write', { uuid: 'Actor.a1' }), player)).toMatchObject({
      text: expect.stringContaining('renamed'),
    });
  });

  it('marks compendium targets not undoable', async () => {
    const store = makeStore();
    store.add(writable('Compendium.w.p.Actor.x', {}, 1));
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      categoryOf: () => 'write',
      fromUuid: store.fromUuid,
      submit: async (r) => void records.push(r),
    });
    const d = createDispatcher({
      tools,
      handlers: {
        fixture_write: async (ctx) => (
          await ctx.snapshot?.('Compendium.w.p.Actor.x'),
          { text: 'k', structured: {} }
        ),
      },
      stages: [stage],
    });
    await d(call('fixture_write', {}), player);
    expect(records[0]!.targets[0]).toMatchObject({ undoable: false });
  });
});
