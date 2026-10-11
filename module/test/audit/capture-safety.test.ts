/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuditStage } from '../../src/audit/stage.js';
import { AuditWitness, changedKeyPaths } from '../../src/audit/witness.js';
import { makeStore, record, writable } from './fake.js';

function rig() {
  const store = makeStore();
  const doc = store.add(writable('Actor.A', { name: 'Before' }, 10, store));
  const submit = vi.fn<(record: unknown) => Promise<void>>(async () => {});
  const lookup = vi.fn(store.fromUuid);
  let observed: (...args: any[]) => void = () => {};
  const stage = createAuditStage({
    categoryOf: () => 'write',
    isGM: () => true,
    fromUuid: lookup,
    submit,
    newId: () => 'capture-safety-001',
    now: () => 100,
    watchChanges: (changed) => {
      observed = changed;
      return () => {};
    },
  });
  const ctx: any = {
    tool: 'fixture_write',
    user: { id: 'gm1', isGM: true },
    agent: { id: 'agent' },
    args: {},
  };
  return { store, doc, submit, lookup, stage, ctx, changed: (...args: any[]) => observed(...args) };
}

afterEach(() => vi.restoreAllMocks());

describe('capture lookup failures', () => {
  it('does not let a failed snapshot lookup turn an existing document into an undo-delete target', async () => {
    const { doc, lookup, stage, ctx } = rig();
    lookup.mockRejectedValueOnce(new Error('temporary lookup failure'));
    await expect(
      stage.run(ctx, async () => {
        await ctx.snapshot(doc.uuid);
        doc.data.name = 'After';
        return { text: 'ok', structured: {} };
      }),
    ).rejects.toThrow('temporary lookup failure');
    expect(doc.data.name).toBe('Before');
  });

  it('disables undo when the final state cannot be resolved', async () => {
    const { doc, submit, lookup, stage, ctx } = rig();
    lookup
      .mockResolvedValueOnce(doc)
      .mockRejectedValueOnce(new Error('temporary final lookup failure'));
    await stage.run(ctx, async () => {
      await ctx.snapshot(doc.uuid);
      doc.data.name = 'After';
      return { text: 'ok', structured: {} };
    });
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: [
          expect.objectContaining({ undoable: false, note: expect.stringContaining('lookup') }),
        ],
      }),
    );
  });

  it('does not acknowledge a witnessed capture whose lookup failed', async () => {
    const witness = new AuditWitness({
      fromUuid: async () => {
        throw new Error('temporary lookup failure');
      },
      now: () => 1,
      grace: async () => {},
    });
    expect(await witness.onIntent({ callId: 'lookup-failed-001', uuid: 'Actor.A' }, 'p1')).toBe(
      false,
    );
  });
});

describe('flattened hook paths', () => {
  it('normalises deletion and replacement operators in any dotted segment', () => {
    expect(
      changedKeyPaths({
        'flags.mod.-=state': null,
        'flags.mod.==other': { whole: { object: 1 } },
        '_stats.modifiedTime': 20,
      }).sort(),
    ).toEqual(['flags.mod.other', 'flags.mod.state']);
  });
});

describe('GM snapshot eligibility', () => {
  it.each([true, false])(
    'refuses delete-and-recreate lifecycles (created bookkeeping: %s)',
    async (bookkeeping) => {
      const { store, doc, submit, stage, ctx, changed } = rig();
      doc.data.items = [{ _id: 'X', name: 'Original item' }];
      await stage.run(ctx, async () => {
        await ctx.snapshot(doc.uuid);
        await doc.delete();
        const replacement = store.add(
          writable(doc.uuid, { name: 'Replacement', items: [{ _id: 'Y' }] }, 20, store),
        );
        changed(doc.uuid, ctx.callOptions, ctx.user.id, 'create');
        if (bookkeeping) await ctx.created(replacement.uuid);
        return { text: 'ok', structured: {} };
      });
      expect(submit.mock.calls[0]?.[0]).toMatchObject({
        targets: [{ existed: true, undoable: false, note: 'deleted and recreated in one call' }],
      });
    },
  );

  it('records unsupported document classes as view-only', async () => {
    const { store, submit, stage, ctx } = rig();
    store.add(writable('Macro.M', { command: 'before' }, 10, store));
    await stage.run(ctx, async () => {
      await ctx.snapshot('Macro.M');
      return { text: 'ok', structured: {} };
    });
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      targets: [{ uuid: 'Macro.M', undoable: false, note: expect.stringContaining('not undone') }],
    });
  });
});

describe('capture completeness', () => {
  it('captures the ancestor at the first flattened replacement operator', () => {
    expect(changedKeyPaths({ 'flags.==scope.new': 2 })).toEqual(['flags.scope']);
    expect(changedKeyPaths({ flags: { '==scope.new': 2 } })).toEqual(['flags.scope']);
  });

  it('rejects oversized root paths for non-recursive updates', () => {
    expect(() => changedKeyPaths({ ['x'.repeat(201)]: 1 }, false)).toThrow('capture limit');
  });

  it.each([0, 1, 3])(
    'reports witnessed target overflow without double-counting %s claimed drops',
    async (claimedDrops) => {
      const created = new Map<string, any>();
      const witness = new AuditWitness({
        fromUuid: async (uuid) => created.get(uuid),
        now: () => 1,
        grace: async () => {},
      });
      const callId = 'witness-overflow-001';
      await witness.onIntent({ callId, creates: true }, 'p1');
      for (let i = 0; i < 51; i++) {
        const doc = {
          uuid: `Actor.A${i}`,
          id: `A${i}`,
          documentName: 'Actor',
          parent: null,
          _stats: { modifiedTime: 2 },
        };
        created.set(doc.uuid, doc);
        witness.onCreate(doc, { agentGateway: { callId } }, 'p1');
      }
      const result = await witness.assemble(
        record({ entryId: callId, targetsDropped: claimedDrops }),
        'p1',
      );
      expect(result.targets).toHaveLength(50);
      expect(result.targetsDropped).toBe(Math.max(1, claimedDrops));
    },
  );
});
