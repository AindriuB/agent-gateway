/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineTool } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pageData } from '../../src/audit/journal.js';
import { AuditRelay, type RelayDeps } from '../../src/audit/relay.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { AUDIT_LIMITS as L, type AuditRecord } from '../../src/audit/types.js';
import { minimalRestore, undoEntry, type UndoDeps } from '../../src/audit/undo.js';
import {
  AuditWitness,
  CAPPED_NOTE,
  EXPIRED_NOTE,
  installWitnessHooks,
  NOT_WITNESSED_NOTE,
  RECREATED_NOTE,
} from '../../src/audit/witness.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { makeStore, record, writable } from './fake.js';

const opts = (callId: string) => ({ agentGateway: { callId } });
const cid = (i: number) => `call-${String(i).padStart(8, '0')}`;

function world() {
  const store = makeStore();
  let now = 1000;
  const handlers = new Map<string, Array<(...a: any[]) => void>>();
  const hooks = {
    on: (n: string, f: (...a: any[]) => void) => handlers.set(n, [...(handlers.get(n) ?? []), f]),
  };
  const cancels: number[] = [];
  const intervals: Array<() => void> = [];
  const witness = new AuditWitness({
    fromUuid: store.fromUuid,
    now: () => now,
    grace: async () => {},
    every: (fn) => {
      intervals.push(fn);
      return () => void cancels.push(1);
    },
  });
  installWitnessHooks(hooks, witness, () => true);
  const emit = (n: string, ...a: any[]) => (handlers.get(n) ?? []).forEach((f) => f(...a));
  const doc = (uuid: string, data: any = {}, mod = 5, createdBy?: string) => {
    const d = store.add(writable(uuid, data, mod, store));
    if (createdBy) d._stats.createdBy = createdBy;
    return d;
  };
  return {
    store,
    witness,
    emit,
    doc,
    cancels,
    intervals,
    advance: (ms: number) => (now += ms),
  };
}
const entry = (id: string, targets: object[]): AuditRecord => ({
  ...record({ entryId: id }),
  targets: targets as any,
  relayed: true,
});
const stored = (r: AuditRecord) => {
  const d = pageData(r) as any;
  const page: any = { id: 'pg', system: d.system, update: async () => {} };
  return page;
};
const undoDeps = (store: ReturnType<typeof makeStore>): Partial<UndoDeps> => ({
  isGM: () => true,
  canModify: () => true,
  canCreate: () => true,
  userId: () => 'gm1',
  fromUuid: store.fromUuid,
  now: () => 9,
});
const claim = (uuid: string) => ({ uuid, existed: false, existsAfter: false, undoable: false });

afterEach(() => vi.restoreAllMocks());

describe('1. stale snapshots', () => {
  it('a GM edit between the intent and the sender update makes the update target not undoable, naming the user', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(1), uuid: 'Actor.a1' }, 'p1');
    w.emit('updateActor', d, { name: 'GM edit' }, {}, 'gm1');
    w.emit('updateActor', d, { name: 'Agent' }, opts(cid(1)), 'p1');
    const out = await w.witness.assemble(entry(cid(1), [claim('Actor.a1')]), 'p1');
    expect(out.targets[0]).toMatchObject({ undoable: false });
    expect(out.targets[0]!.note).toContain('gm1');
    expect(out.targets[0]!.note).toContain('stale');
  });

  it('a GM edit, then the sender delete, is not undoable either', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(2), uuid: 'Actor.a1' }, 'p1');
    w.emit('updateActor', d, { name: 'GM edit' }, {}, 'gm1');
    w.emit('deleteActor', d, opts(cid(2)), 'p1');
    const out = await w.witness.assemble(entry(cid(2), [claim('Actor.a1')]), 'p1');
    expect(out.targets[0]).toMatchObject({ undoable: false });
  });

  it('another user deleting it, or the sender editing outside the call, also makes it stale', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    const e = w.doc('Actor.b1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(3), uuid: 'Actor.a1' }, 'p1');
    await w.witness.onIntent({ callId: cid(3), uuid: 'Actor.b1' }, 'p1');
    w.emit('deleteActor', d, {}, 'gm1');
    w.emit('updateActor', e, { name: 'X' }, {}, 'p1');
    w.emit('updateActor', e, { name: 'Y' }, opts(cid(3)), 'p1');
    const out = await w.witness.assemble(
      entry(cid(3), [claim('Actor.a1'), claim('Actor.b1')]),
      'p1',
    );
    expect(out.targets.map((t) => t.undoable)).toEqual([false, false]);
  });

  it('control: with no intervening change the same sequence is undoable', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(4), uuid: 'Actor.a1' }, 'p1');
    w.emit('updateActor', d, { name: 'Agent' }, opts(cid(4)), 'p1');
    const out = await w.witness.assemble(entry(cid(4), [claim('Actor.a1')]), 'p1');
    expect(out.targets[0]).toMatchObject({ undoable: true, changedPaths: ['name'] });
  });
});

describe('2. time to live', () => {
  it('observations after expiry are ignored, and an expired call never makes a target undoable', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(5), uuid: 'Actor.a1' }, 'p1');
    w.emit('updateActor', d, { name: 'In time' }, opts(cid(5)), 'p1');
    w.advance(L.callTtlMs + 1);
    const out = await w.witness.assemble(entry(cid(5), [claim('Actor.a1')]), 'p1');
    expect(out.targets[0]).toMatchObject({ undoable: false, note: EXPIRED_NOTE });
  });

  it('onUpdate, onDelete and onCreate ignore an expired call (it is dropped on sight)', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    const c = w.doc('Item.n1', {}, 1, 'p1');
    await w.witness.onIntent({ callId: cid(6), uuid: 'Actor.a1' }, 'p1');
    await w.witness.onIntent({ callId: cid(6), creates: true }, 'p1');
    w.advance(L.callTtlMs + 1);
    w.emit('updateActor', d, { name: 'late' }, opts(cid(6)), 'p1');
    w.emit('deleteActor', d, opts(cid(6)), 'p1');
    w.emit('createItem', c, opts(cid(6)), 'p1');
    expect(w.witness.open).toBe(0);
    const out = await w.witness.assemble(
      entry(cid(6), [claim('Actor.a1'), claim('Item.n1')]),
      'p1',
    );
    expect(out.targets.every((t) => !t.undoable)).toBe(true);
    expect(out.targets[0]!.note).toBe(NOT_WITNESSED_NOTE);
  });

  it('a periodic sweep frees expired calls, and stop clears the timer and everything held', async () => {
    const w = world();
    w.doc('Actor.a1', {});
    w.witness.start();
    w.witness.start();
    expect(w.intervals).toHaveLength(1);
    await w.witness.onIntent({ callId: cid(7), uuid: 'Actor.a1' }, 'p1');
    expect(w.witness.open).toBe(1);
    w.advance(L.callTtlMs + 1);
    w.intervals[0]!();
    expect(w.witness.open).toBe(0);
    await w.witness.onIntent({ callId: cid(8), uuid: 'Actor.a1' }, 'p1');
    w.witness.stop();
    expect(w.cancels).toHaveLength(1);
    expect(w.witness.open).toBe(0);
  });
});

describe('3. memory caps', () => {
  const big = (n: number) => 'x'.repeat(n);

  it('caps retained bytes per sender: later calls are refused and a capped call is not undoable', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) w.doc(`Actor.big${i}`, { blob: big(190_000) });
    let refused = -1;
    // Three documents of about 190 KB fit in one call; four calls reach the 2 MB per-sender cap.
    for (let c = 0; c < 6 && refused < 0; c++) {
      for (let k = 0; k < 3; k++) {
        const ok = await w.witness.onIntent(
          { callId: cid(100 + c), uuid: `Actor.big${c * 3 + k}` },
          'p1',
        );
        if (!ok && refused < 0) refused = c;
      }
    }
    expect(refused).toBeGreaterThan(0);
    const bad = await w.witness.assemble(
      entry(cid(100 + refused), [claim(`Actor.big${refused * 3}`)]),
      'p1',
    );
    expect(bad.targets.every((t) => !t.undoable)).toBe(true);
    expect(bad.targets[0]!.note).toBe(CAPPED_NOTE);
    // Another sender is unaffected by p1's cap.
    expect(await w.witness.onIntent({ callId: cid(200), uuid: 'Actor.big0' }, 'p2')).toBe(true);
  });

  it('caps the total across senders', async () => {
    const w = world();
    w.doc('Actor.a', { blob: big(190_000) });
    let refused = false;
    for (let s = 0; s < 120 && !refused; s++) {
      for (let c = 0; c < 2 && !refused; c++) {
        const ok = await w.witness.onIntent({ callId: cid(300 + c), uuid: 'Actor.a' }, `u${s}`);
        if (!ok) refused = true;
      }
    }
    expect(refused).toBe(true);
  });

  it('an observation flood caps the call: nothing in it is undoable', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await w.witness.onIntent({ callId: cid(9), uuid: 'Actor.a1' }, 'p1');
    for (let i = 0; i < L.observed + 50; i++)
      w.emit('updateActor', d, { name: `n${i}` }, opts(cid(9)), 'p1');
    const out = await w.witness.assemble(entry(cid(9), [claim('Actor.a1')]), 'p1');
    expect(out.targets.every((t) => !t.undoable)).toBe(true);
    expect(out.targets[0]!.note).toBe(CAPPED_NOTE);
  });
});

describe('4. delete then recreate in one call', () => {
  it('a declared uuid deleted and then created is not undoable', async () => {
    const w = world();
    const d = w.doc('Item.i1', { name: 'Orig' });
    await w.witness.onIntent({ callId: cid(10), uuid: 'Item.i1' }, 'p1');
    await w.witness.onIntent({ callId: cid(10), creates: true }, 'p1');
    w.store.docs.delete('Item.i1');
    w.emit('deleteItem', d, opts(cid(10)), 'p1');
    const replacement = w.doc('Item.i1', { name: 'Replacement' }, 7, 'p1');
    w.emit('createItem', replacement, opts(cid(10)), 'p1');
    const out = await w.witness.assemble(entry(cid(10), [claim('Item.i1')]), 'p1');
    expect(out.targets).toHaveLength(1);
    expect(out.targets[0]).toMatchObject({
      uuid: 'Item.i1',
      undoable: false,
      note: RECREATED_NOTE,
    });
    const doc = replacement;
    await undoEntry(
      stored(out),
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    expect(doc.calls.deleted).toBe(0);
  });
});

describe('5. type changes at a changed path', () => {
  it('restores the whole ancestor when it was a primitive, null or array and became an object', () => {
    expect(minimalRestore({ a: 5 }, ['a.b'])).toEqual({ a: 5 });
    expect(minimalRestore({ a: null }, ['a.b.c'])).toEqual({ a: null });
    expect(minimalRestore({ s: { a: [1, 2] } }, ['s.a.b'])).toEqual({ 's.a': [1, 2] });
  });
  it('restores an object when a leaf became a primitive, and removes the first missing key', () => {
    expect(minimalRestore({ a: { b: 1 } }, ['a'])).toEqual({ a: { b: 1 } });
    expect(minimalRestore({ a: {} }, ['a.b.c'])).toEqual({ 'a.-=b': null });
  });
  it('drops a path under an ancestor that is restored whole', () => {
    expect(minimalRestore({ a: 5 }, ['a.b', 'a.c.d'])).toEqual({ a: 5 });
  });
  it('through undo: 5 to {b:1} is written back as 5', async () => {
    const w = world();
    const d = w.doc('Actor.a1', { a: 5 });
    await w.witness.onIntent({ callId: cid(11), uuid: 'Actor.a1' }, 'p1');
    d.data.a = { b: 1 };
    w.emit('updateActor', d, { a: { b: 1 } }, opts(cid(11)), 'p1');
    const out = await w.witness.assemble(entry(cid(11), [claim('Actor.a1')]), 'p1');
    expect(out.targets[0]!.changedPaths).toEqual(['a.b']);
    await undoEntry(
      stored(out),
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    expect(d.calls.update[0]!.data).toEqual({ a: 5 });
  });
});

describe('6. smaller fixes', () => {
  const tool = defineTool({
    name: 'fixture_write',
    minRole: 'player',
    category: 'write',
    handledBy: 'module',
    description: 'x',
    input: z.strictObject({}),
    output: z.strictObject({}),
  });
  const FLAG = { 'agent-gateway': { auditJournal: true } };
  const run = async (body: (ctx: any) => Promise<void>, isGM = true) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore();
    const j = store.add(writable('JournalEntry.aj', {}, 1, store));
    j.flags = FLAG;
    const page = store.add(writable('JournalEntry.aj.JournalEntryPage.pg', {}, 1, store));
    page.parent = j;
    const d = createDispatcher({
      tools: [tool],
      handlers: {
        fixture_write: async (ctx) => (await body({ ctx, j, page }), { text: 'x', structured: {} }),
      },
      stages: [
        createAuditStage({
          isGM: () => isGM,
          categoryOf: () => 'write',
          fromUuid: store.fromUuid,
          requestIntent: async () => true,
          submit: async () => {},
        }),
      ],
    });
    return d(
      {
        tool: 'fixture_write',
        args: {},
        agent: { id: 'a', ownerUserId: 'g', headless: false },
        sessionId: 's',
      },
      { id: 'g', isGM },
    );
  };

  it('created() and intendCreate() refuse the audit log as parent (a document or a uuid), GM or player client', async () => {
    for (const isGM of [true, false]) {
      expect(await run(async ({ ctx, j }) => ctx.intendCreate(j), isGM)).toMatchObject({
        error: { code: 'INTERNAL' },
      });
      expect(await run(async ({ ctx }) => ctx.intendCreate('JournalEntry.aj'), isGM)).toMatchObject(
        { error: { code: 'INTERNAL' } },
      );
      expect(await run(async ({ ctx, j }) => ctx.created('Item.x', j), isGM)).toMatchObject({
        error: { code: 'INTERNAL' },
      });
      expect(
        await run(async ({ ctx }) => ctx.created('JournalEntry.aj.JournalEntryPage.pg'), isGM),
      ).toMatchObject({ error: { code: 'INTERNAL' } });
    }
    expect(await run(async ({ ctx }) => ctx.intendCreate({ flags: {} }))).toMatchObject({
      text: 'x',
    });
  });

  function relayRig(self: string, isGM: boolean, activeGM: string | null, gms: string[]) {
    const sent: Array<{ msg: any; to: string[] }> = [];
    const written: Array<{ r: AuditRecord; sender: string }> = [];
    const relay = new AuditRelay({
      selfId: () => self,
      isGM: () => isGM,
      activeGMId: () => activeGM,
      isUserGM: (u) => gms.includes(u),
      emit: (msg, to) => void sent.push({ msg, to }),
      write: async (r, sender) => void written.push({ r, sender }),
      onIntent: async () => true,
      setTimer: () => 0,
      clearTimer: () => {},
      now: () => 1,
    } as RelayDeps);
    return { relay, sent, written };
  }

  it('intents have their own larger budget, separate from entries', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = relayRig('gm1', true, 'gm1', ['gm1']);
    for (let i = 0; i < 500; i++)
      await g.relay.onMessage({ kind: 'audit.intent', callId: cid(i), uuid: 'Actor.a' }, 'p1');
    expect(g.sent.filter((s) => s.msg.kind === 'audit.intent.ack')).toHaveLength(500);
    await g.relay.onMessage(
      { kind: 'audit.entry', record: record({ entryId: 'entry-000001a' }) },
      'p1',
    );
    expect(g.written).toHaveLength(1);
    for (let i = 500; i < 700; i++)
      await g.relay.onMessage({ kind: 'audit.intent', callId: cid(i), uuid: 'Actor.a' }, 'p1');
    expect(g.sent.filter((s) => s.msg.kind === 'audit.intent.ack')).toHaveLength(600);
  });

  it('a GM client that is not the active GM buffers and relays instead of writing; the active GM writes it with its targets kept', async () => {
    const second = relayRig('gm2', true, 'gm1', ['gm1', 'gm2']);
    await second.relay.submit(
      record({
        userId: 'gm2',
        targets: [
          {
            ...record().targets[0]!,
            uuid: 'Actor.a',
            existed: true,
            before: { n: 1 },
            undoable: true,
          } as any,
        ],
      }),
    );
    expect(second.written).toEqual([]);
    expect(second.sent).toHaveLength(1);
    expect(second.sent[0]).toMatchObject({ to: ['gm1'], msg: { kind: 'audit.entry' } });
    const active = relayRig('gm1', true, 'gm1', ['gm1', 'gm2']);
    await active.relay.onMessage(second.sent[0]!.msg, 'gm2');
    expect(active.written[0]!.r).toMatchObject({ relayed: false, userId: 'gm2' });
    expect(active.written[0]!.r.targets[0]).toMatchObject({ undoable: true, before: { n: 1 } });
  });

  it('the active GM still records a player entry as relayed and view-only', async () => {
    const active = relayRig('gm1', true, 'gm1', ['gm1']);
    await active.relay.onMessage(
      {
        kind: 'audit.entry',
        record: record({
          targets: [{ uuid: 'Actor.a', existed: true, before: { n: 1 }, undoable: true } as any],
        }),
      },
      'p1',
    );
    expect(active.written[0]!.r.relayed).toBe(true);
    expect(active.written[0]!.r.targets[0]).toMatchObject({ undoable: false, before: null });
  });
});
