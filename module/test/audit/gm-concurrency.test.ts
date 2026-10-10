/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageData } from '../../src/audit/journal.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { undoEntry } from '../../src/audit/undo.js';
import type { AuditRecord } from '../../src/audit/types.js';
import type { OpContext } from '../../src/ops/types.js';
import { reserveFixtureUndo, makeStore, writable } from './fake.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function rig() {
  const hooks = new Map<string, Set<(...args: any[]) => void>>();
  vi.stubGlobal('Hooks', {
    on: (name: string, fn: (...args: any[]) => void) => {
      if (!hooks.has(name)) hooks.set(name, new Set());
      hooks.get(name)!.add(fn);
      return fn;
    },
    off: (name: string, fn: (...args: any[]) => void) => hooks.get(name)?.delete(fn),
  });
  const emit = (name: string, ...args: any[]) => hooks.get(name)?.forEach((fn) => fn(...args));
  const store = makeStore();
  const doc = store.add(writable('Actor.a1', { name: 'Before', hp: 9 }, 1));
  const records: AuditRecord[] = [];
  const stage = createAuditStage({
    isGM: () => true,
    fromUuid: store.fromUuid,
    categoryOf: () => 'write',
    submit: async (r) => {
      records.push(r);
    },
    newId: () => 'call-gm00001',
  });
  const ctx: OpContext = {
    user: { id: 'gm1', isGM: true },
    agent: { id: 'a1', ownerUserId: 'gm1', headless: false },
    sessionId: 's1',
    tool: 'fixture_write',
    args: {},
  };
  const listeners = () => [...hooks.values()].reduce((n, set) => n + set.size, 0);
  return { stage, ctx, store, doc, records, emit, listeners };
}

describe('GM snapshot conflicts during execution', () => {
  it.each([
    ['another user', 'p1', {}],
    ['the GM outside this call', 'gm1', {}],
    ['another call by the GM', 'gm1', { agentGateway: { callId: 'call-other01' } }],
  ])('an edit by %s cannot be silently overwritten by undo', async (_label, userId, options) => {
    const { stage, ctx, store, doc, records, emit, listeners } = rig();
    await stage.run(ctx, async () => {
      await ctx.snapshot!(doc.uuid);
      doc.data.hp = 3;
      doc._stats.modifiedTime = 2;
      emit('updateActor', doc, { hp: 3 }, options, userId);
      doc.data.name = 'After';
      doc._stats.modifiedTime = 3;
      emit('updateActor', doc, { name: 'After' }, ctx.callOptions, 'gm1');
      return { text: 'renamed', structured: {} };
    });
    expect(listeners()).toBe(0);
    expect(records[0]!.targets[0]).toMatchObject({
      undoable: false,
      note: expect.stringContaining('stale'),
    });
    const data = pageData(records[0]!) as any;
    const page = { id: 'page', system: data.system, update: vi.fn() };
    const outcome = await undoEntry(page, async () => true, {
      reserve: reserveFixtureUndo,
      isGM: () => true,
      userId: () => 'gm1',
      fromUuid: store.fromUuid,
      canModify: () => true,
      canCreate: () => true,
      now: () => 10,
    });
    expect(outcome.restored).toBe(0);
    expect(doc.calls.update).toEqual([]);
    expect(doc.data.hp).toBe(3);
  });

  it.each(['delete', 'create'])(
    'an external %s also invalidates the full snapshot',
    async (kind) => {
      const { stage, ctx, doc, records, emit } = rig();
      await stage.run(ctx, async () => {
        await ctx.snapshot!(doc.uuid);
        emit(`${kind}Actor`, doc, {}, 'p1');
        return { text: 'finished', structured: {} };
      });
      expect(records[0]!.targets[0]).toMatchObject({
        undoable: false,
        note: expect.stringContaining('stale'),
      });
    },
  );

  it('an update from this call remains undoable and hooks are removed afterwards', async () => {
    const { stage, ctx, doc, records, emit, listeners } = rig();
    await stage.run(ctx, async () => {
      await ctx.snapshot!(doc.uuid);
      expect(listeners()).toBeGreaterThan(0);
      doc.data.name = 'After';
      doc._stats.modifiedTime = 2;
      emit('updateActor', doc, { name: 'After' }, ctx.callOptions, 'gm1');
      return { text: 'renamed', structured: {} };
    });
    expect(records[0]!.targets[0]).toMatchObject({ undoable: true, note: '' });
    expect(listeners()).toBe(0);
  });

  it('removes its hooks when the handler throws', async () => {
    const { stage, ctx, doc, listeners } = rig();
    await expect(
      stage.run(ctx, async () => {
        await ctx.snapshot!(doc.uuid);
        expect(listeners()).toBeGreaterThan(0);
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(listeners()).toBe(0);
  });
});
