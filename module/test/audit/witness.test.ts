/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineTool } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { pageData } from '../../src/audit/journal.js';
import { AuditRelay, type RelayDeps } from '../../src/audit/relay.js';
import { createAuditStage } from '../../src/audit/stage.js';
import { minimalRestore, undoEntry, type UndoDeps } from '../../src/audit/undo.js';
import {
  AuditWitness,
  changedKeyPaths,
  installWitnessHooks,
  NOT_OBSERVED_NOTE,
  NOT_WITNESSED_NOTE,
} from '../../src/audit/witness.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { makeStore, record, target, writable } from './fake.js';

const CALL = 'call-0000001';

/** A GM client's world: its own document copies, the hooks Foundry would fire, the witness and the relay. */
function gmWorld() {
  const store = makeStore();
  const handlers = new Map<string, Array<(...a: any[]) => void>>();
  const hooks = {
    on: (n: string, f: (...a: any[]) => void) => handlers.set(n, [...(handlers.get(n) ?? []), f]),
  };
  const witness = new AuditWitness({
    fromUuid: store.fromUuid,
    now: () => 1000,
    grace: async () => {},
  });
  installWitnessHooks(hooks, witness, () => true);
  const emit = (name: string, ...args: any[]) =>
    (handlers.get(name) ?? []).forEach((f) => f(...args));
  const sent: Array<{ msg: any; to: string[] }> = [];
  const written: AuditRecord[] = [];
  const relay = new AuditRelay({
    selfId: () => 'gm1',
    isGM: () => true,
    activeGMId: () => 'gm1',
    isUserGM: (u) => u === 'gm1',
    emit: (msg, to) => void sent.push({ msg, to }),
    write: async (r, sender) =>
      void written.push(r.relayed ? await witness.assemble(r, sender) : r),
    onIntent: (m, s) => witness.onIntent(m, s),
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => 1,
  });
  const doc = (uuid: string, data: any, mod = 5, createdBy?: string) => {
    const d = store.add(writable(uuid, data, mod, store));
    if (createdBy) d._stats.createdBy = createdBy;
    return d;
  };
  return { store, witness, relay, emit, sent, written, doc };
}
const opts = (callId = CALL) => ({ agentGateway: { callId } });
const intent = (w: ReturnType<typeof gmWorld>, uuid: string, sender = 'p1', callId = CALL) =>
  w.relay.onMessage({ kind: 'audit.intent', callId, uuid }, sender);
const entry = (w: ReturnType<typeof gmWorld>, over: object = {}, sender = 'p1') =>
  w.relay.onMessage(
    { kind: 'audit.entry', record: { ...record({ entryId: CALL }), ...over } },
    sender,
  );

const undoDeps = (store: ReturnType<typeof makeStore>): Partial<UndoDeps> => ({
  isGM: () => true,
  canModify: () => true,
  canCreate: () => true,
  userId: () => 'gm1',
  fromUuid: store.fromUuid,
  now: () => 9,
});
const stored = (r: AuditRecord) => {
  const d = pageData(r) as any;
  const page: any = {
    id: 'pg',
    system: d.system,
    updates: [] as any[],
    update: async (u: any) => void page.updates.push(u),
  };
  return page;
};

afterEach(() => vi.restoreAllMocks());

describe('changedKeyPaths and minimalRestore', () => {
  it('flattens a diff to leaf key paths, names -= and == keys, skips _stats and unsafe segments', () => {
    const paths = changedKeyPaths({
      _id: 'x',
      _stats: { modifiedTime: 1 },
      name: 'N',
      system: { hp: { value: 3 }, tags: ['a'] },
      flags: { mod: { '-=old': null } },
      '==items': {},
      ['__proto__']: { x: 1 },
    });
    expect(paths.sort()).toEqual(
      ['flags.mod.old', 'items', 'name', 'system.hp.value', 'system.tags'].sort(),
    );
  });

  it('restores listed paths from the snapshot and removes ones it lacks', () => {
    const before = { name: 'Old', system: { hp: { value: 9, max: 10 } } };
    expect(
      minimalRestore(before, ['name', 'system.hp.value', 'flags.mod.added', '__proto__.x']),
    ).toEqual({
      name: 'Old',
      'system.hp.value': 9,
      '-=flags': null,
    });
  });
});

describe('the GM witnesses a player agent change', () => {
  it('copies the document from its own world on intent, correlates the hook by attested user and call id, and undoes only the changed keys', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Old', system: { hp: 9, mp: 4 } });
    await intent(w, 'Actor.a1');
    expect(w.sent[0]).toMatchObject({
      to: ['p1'],
      msg: { kind: 'audit.intent.ack', callId: CALL, uuid: 'Actor.a1', ok: true },
    });
    // The player's agent changes the name; Foundry fires the hook on the GM client.
    d.data.name = 'New';
    d._stats.modifiedTime = 20;
    w.emit('updateActor', d, { name: 'New' }, opts(), 'p1');
    // The player's record claims a bigger change and supplies its own "before".
    await entry(w, {
      targets: [
        {
          uuid: 'Actor.a1',
          existed: true,
          undoable: true,
          before: { name: 'Old', system: { hp: 999, mp: 999 } },
          changedPaths: ['system.hp'],
        },
      ],
    });
    const rec = w.written[0]!;
    expect(rec.relayed).toBe(true);
    expect(rec.userId).toBe('p1');
    expect(rec.targets).toHaveLength(1);
    expect(rec.targets[0]).toMatchObject({
      uuid: 'Actor.a1',
      changedPaths: ['name'],
      undoable: true,
      afterModifiedTime: 20,
    });
    expect((rec.targets[0]!.before as any).system).toEqual({ hp: 9, mp: 4 });
    const page = stored(rec);
    const out = await undoEntry(
      page,
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    expect(out.status).toBe('done');
    expect(d.calls.update).toEqual([{ data: { name: 'Old' }, opts: { diff: false } }]);
  });

  it('keeps witnessed undo data when another sender submits the same call ID first', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await intent(w, d.uuid);
    d.data.name = 'New';
    d._stats.modifiedTime = 20;
    w.emit('updateActor', d, { name: 'New' }, opts(), 'p1');
    // The other player knows the hook's callId and even claims the real user's identity.
    await entry(w, { userId: 'p1', targets: [target()] }, 'p2');
    await entry(w, { targets: [target()] }, 'p1');
    expect(w.written).toHaveLength(2);
    expect(w.written[0]).toMatchObject({ userId: 'p2', targets: [{ undoable: false }] });
    expect(w.written[1]).toMatchObject({
      userId: 'p1',
      targets: [{ undoable: true, changedPaths: ['name'] }],
    });
    expect(
      await undoEntry(stored(w.written[1]!), async () => true, undoDeps(w.store)),
    ).toMatchObject({ status: 'done', restored: 1 });
    expect(d.data.name).toBe('Old');
  });

  it('a forged relay that supplies a before, a created target or undoable flags has no effect on undo', async () => {
    const w = gmWorld();
    const victim = w.doc('Actor.victim', { name: 'Keep' });
    const user = w.doc('User.u9', { role: 1 });
    await entry(w, {
      targets: [
        {
          uuid: 'Actor.victim',
          existed: true,
          undoable: true,
          before: { name: 'EVIL' },
          existsAfter: true,
        },
        { uuid: 'User.u9', existed: false, undoable: true },
        {
          uuid: 'Actor.gone',
          existed: true,
          undoable: true,
          before: { _id: 'gone', name: 'x' },
          existsAfter: false,
        },
      ],
    });
    const rec = w.written[0]!;
    expect(rec.targets.every((t) => !t.undoable && t.before === null)).toBe(true);
    expect(rec.targets.every((t) => t.note === NOT_WITNESSED_NOTE)).toBe(true);
    const created: unknown[] = [];
    (globalThis as any).getDocumentClass = () => ({
      create: async (x: unknown) => void created.push(x),
    });
    const out = await undoEntry(
      stored(rec),
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    delete (globalThis as any).getDocumentClass;
    expect(out.restored).toBe(0);
    expect(victim.calls.update).toEqual([]);
    expect(user.calls.deleted).toBe(0);
    expect(created).toEqual([]);
  });

  it('a created target is undoable only if the server-set user and _stats.createdBy are the sender and the call declared creation', async () => {
    const w = gmWorld();
    const mine = w.doc('Item.new1', { name: 'Made' }, 7, 'p1');
    const theirs = w.doc('Item.new2', { name: 'Other' }, 7, 'p2');
    const spoof = w.doc('Item.new3', { name: 'Spoof' }, 7, 'p2');
    await w.relay.onMessage({ kind: 'audit.intent', callId: CALL, creates: true }, 'p1');
    w.emit('createItem', mine, opts(), 'p1');
    w.emit('createItem', theirs, opts(), 'p1'); // hook user p1 but created by p2: not the sender's
    w.emit('createItem', spoof, opts(), 'p2'); // a different user's hook with p1's call id
    await entry(w, {
      targets: [
        { uuid: 'Item.new1', existed: false },
        { uuid: 'Item.new2', existed: false, undoable: true },
        { uuid: 'Item.new3', existed: false, undoable: true },
      ],
    });
    const byUuid = Object.fromEntries(w.written[0]!.targets.map((t) => [t.uuid, t]));
    expect(byUuid['Item.new1']).toMatchObject({ undoable: true, existed: false });
    expect(byUuid['Item.new2']!.undoable).toBe(false);
    expect(byUuid['Item.new3']!.undoable).toBe(false);
    await undoEntry(
      stored(w.written[0]!),
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    expect(mine.calls.deleted).toBe(1);
    expect(theirs.calls.deleted).toBe(0);
    expect(spoof.calls.deleted).toBe(0);
  });

  it('a create with no declared intent to create is not recorded', async () => {
    const w = gmWorld();
    const d = w.doc('Item.n', {}, 1, 'p1');
    await intent(w, 'Actor.none');
    w.emit('createItem', d, opts(), 'p1');
    await entry(w, { targets: [{ uuid: 'Item.n', existed: false }] });
    expect(w.written[0]!.targets[0]).toMatchObject({ undoable: false, note: NOT_OBSERVED_NOTE });
  });

  it('a change by a different user than the intent sender does not correlate', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await intent(w, 'Actor.a1', 'p1');
    w.emit('updateActor', d, { name: 'X' }, opts(), 'p2');
    w.emit('updateActor', d, { name: 'X' }, { agentGateway: { callId: 'other-call-001' } }, 'p1');
    w.emit('updateActor', d, { name: 'X' }, {}, 'p1');
    await entry(w, { targets: [{ uuid: 'Actor.a1', existed: true }] });
    expect(w.written[0]!.targets[0]).toMatchObject({ undoable: false, note: NOT_OBSERVED_NOTE });
  });

  it('an observed update that changed no key path is not undoable', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await intent(w, 'Actor.a1');
    w.emit('updateActor', d, { _stats: { modifiedTime: 3 } }, opts(), 'p1');
    await entry(w, { targets: [{ uuid: 'Actor.a1' }] });
    expect(w.written[0]!.targets[0]).toMatchObject({ undoable: false, note: NOT_OBSERVED_NOTE });
  });

  it('undo itself skips a relayed update target that has no observed paths', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Now' });
    const page = stored(
      record({ relayed: true, targets: [target({ undoable: true, changedPaths: [] })] }),
    );
    const out = await undoEntry(
      page,
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    expect(out.skipped).toEqual(['Actor.a1']);
    expect(d.calls.update).toEqual([]);
  });

  it('an update to a document not in the intent is ignored', async () => {
    const w = gmWorld();
    const a = w.doc('Actor.a1', { name: 'Old' });
    const b = w.doc('Actor.b1', { name: 'Old' });
    await intent(w, 'Actor.a1');
    w.emit('updateActor', b, { name: 'X' }, opts(), 'p1');
    w.emit('updateActor', a, { name: 'X' }, opts(), 'p1');
    await entry(w, { targets: [{ uuid: 'Actor.a1' }, { uuid: 'Actor.b1' }] });
    const t = w.written[0]!.targets;
    expect(t.find((x) => x.uuid === 'Actor.a1')!.undoable).toBe(true);
    expect(t.find((x) => x.uuid === 'Actor.b1')!.undoable).toBe(false);
  });

  it('a witnessed delete is recreated from the GM snapshot, not from anything the player sent', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Original', system: { hp: 9 } });
    await intent(w, 'Actor.a1');
    w.store.docs.delete('Actor.a1');
    w.emit('deleteActor', d, opts(), 'p1');
    await entry(w, {
      targets: [
        {
          uuid: 'Actor.a1',
          existed: true,
          before: { _id: 'a1', name: 'FORGED' },
          existsAfter: false,
        },
      ],
    });
    const created: any[] = [];
    (globalThis as any).getDocumentClass = () => ({
      create: async (x: any, o: any) => void created.push({ x, o }),
    });
    const out = await undoEntry(
      stored(w.written[0]!),
      vi.fn(async () => true),
      undoDeps(w.store),
    );
    delete (globalThis as any).getDocumentClass;
    expect(out.status).toBe('done');
    expect(created).toHaveLength(1);
    expect(created[0].x.name).toBe('Original');
    expect(created[0].x.system).toEqual({ hp: 9 });
    expect(created[0].o).toEqual({ keepId: true });
  });

  it('warns on conflict using the GM-observed modified time', async () => {
    const w = gmWorld();
    const d = w.doc('Actor.a1', { name: 'Old' });
    await intent(w, 'Actor.a1');
    d._stats.modifiedTime = 20;
    w.emit('updateActor', d, { name: 'New' }, opts(), 'p1');
    await entry(w, { targets: [{ uuid: 'Actor.a1' }] });
    d._stats.modifiedTime = 50; // someone edited it afterwards
    const confirm = vi.fn(async () => false);
    const out = await undoEntry(stored(w.written[0]!), confirm, undoDeps(w.store));
    expect(out.status).toBe('cancelled');
    expect(confirm).toHaveBeenCalledWith([{ uuid: 'Actor.a1', reason: 'modified' }]);
    expect(d.calls.update).toEqual([]);
  });

  it('refuses intents for classes undo may not touch, and for the audit journal', async () => {
    const w = gmWorld();
    w.doc('User.u1', {});
    const j = w.doc('JournalEntry.aj', {});
    j.flags = { 'agent-gateway': { auditJournal: true } };
    expect(await w.witness.onIntent({ callId: CALL, uuid: 'User.u1' }, 'p1')).toBe(false);
    expect(await w.witness.onIntent({ callId: CALL, uuid: 'Setting.s' }, 'p1')).toBe(false);
    expect(await w.witness.onIntent({ callId: CALL, uuid: 'JournalEntry.aj' }, 'p1')).toBe(false);
    expect(await w.witness.onIntent({ callId: 'x', uuid: 'Actor.a' }, 'p1')).toBe(false);
  });

  it('bounds open calls per sender', async () => {
    const w = gmWorld();
    for (let i = 0; i < 30; i++) {
      expect(
        await w.witness.onIntent(
          { callId: `call-${String(i).padStart(8, '0')}`, uuid: 'Actor.a' },
          'p1',
        ),
      ).toBe(true);
    }
    expect(await w.witness.onIntent({ callId: 'call-overflow-1', uuid: 'Actor.a' }, 'p1')).toBe(
      false,
    );
    expect(await w.witness.onIntent({ callId: 'call-overflow-1', uuid: 'Actor.a' }, 'p2')).toBe(
      true,
    );
  });
});

describe('the player side of the handshake', () => {
  function player(world: { gm: string | null }) {
    const sent: Array<{ msg: any; to: string[] }> = [];
    const timers: Array<{ fn: () => void; live: boolean }> = [];
    const relay = new AuditRelay({
      selfId: () => 'p1',
      isGM: () => false,
      activeGMId: () => world.gm,
      isUserGM: (u) => u === 'gm1',
      emit: (msg, to) => void sent.push({ msg, to }),
      write: async () => {},
      onIntent: async () => true,
      setTimer: (fn) => {
        const t = { fn, live: true };
        timers.push(t);
        return t;
      },
      clearTimer: (h) => void ((h as any).live = false),
      now: () => 1,
    } as RelayDeps);
    return { relay, sent, timers };
  }

  it('sends the intent to the active GM only and resolves on the GM ack', async () => {
    const p = player({ gm: 'gm1' });
    const pending = p.relay.requestIntent(CALL, { uuid: 'Actor.a1' });
    expect(p.sent).toEqual([
      { msg: { kind: 'audit.intent', callId: CALL, uuid: 'Actor.a1' }, to: ['gm1'] },
    ]);
    await p.relay.onMessage(
      { kind: 'audit.intent.ack', callId: CALL, uuid: 'Actor.a1', ok: true },
      'p2',
    );
    await p.relay.onMessage(
      { kind: 'audit.intent.ack', callId: CALL, uuid: 'Actor.a1', ok: true },
      'gm1',
    );
    expect(await pending).toBe(true);
  });

  it('times out when no GM answers, and then does not wait again for the same call', async () => {
    const p = player({ gm: 'gm1' });
    const first = p.relay.requestIntent(CALL, { uuid: 'Actor.a1' });
    p.timers.at(-1)!.fn();
    expect(await first).toBe(false);
    const sentBefore = p.sent.length;
    expect(await p.relay.requestIntent(CALL, { uuid: 'Actor.b1' })).toBe(false);
    expect(p.sent).toHaveLength(sentBefore);
  });

  it('does not wait at all when no GM is online', async () => {
    const p = player({ gm: null });
    expect(await p.relay.requestIntent(CALL, { uuid: 'Actor.a1' })).toBe(false);
    expect(p.sent).toEqual([]);
  });

  it('a player stage runs the handler only after the intent is acknowledged, and runs it anyway when it is not', async () => {
    const order: string[] = [];
    const tool = defineTool({
      name: 'fixture_write',
      minRole: 'player',
      category: 'write',
      handledBy: 'module',
      description: 'x',
      input: z.strictObject({}),
      output: z.strictObject({}),
    });
    const run = async (witnessed: boolean) => {
      const records: AuditRecord[] = [];
      let release!: (ok: boolean) => void;
      const stage = createAuditStage({
        isGM: () => false,
        categoryOf: () => 'write',
        fromUuid: async () => null,
        requestIntent: (id) => {
          order.push(`intent:${id === records.length + 'x' ? '' : 'sent'}`);
          return new Promise<boolean>((r) => (release = r));
        },
        submit: async (r) => void records.push(r),
        newId: () => CALL,
      });
      const d = createDispatcher({
        tools: [tool],
        handlers: {
          fixture_write: async (ctx) => {
            await ctx.snapshot?.('Actor.a1');
            order.push('mutate');
            expect(ctx.callOptions).toEqual({ agentGateway: { callId: CALL } });
            return { text: 'done', structured: {} };
          },
        },
        stages: [stage],
      });
      const p = d(
        {
          tool: 'fixture_write',
          args: {},
          agent: { id: 'a', ownerUserId: 'p1', headless: false },
          sessionId: 's',
        },
        { id: 'p1', isGM: false },
      );
      await new Promise((r) => setTimeout(r, 5));
      expect(order).not.toContain('mutate');
      release(witnessed);
      await p;
      return records[0]!;
    };
    const rec = await run(false);
    expect(order).toEqual(['intent:sent', 'mutate']);
    // A player's own snapshot is never kept: the target is a name only.
    expect(rec.entryId).toBe(CALL);
    expect(rec.targets).toEqual([
      {
        uuid: 'Actor.a1',
        existed: false,
        before: null,
        existsAfter: false,
        afterModifiedTime: null,
        undoable: false,
        changedPaths: [],
        note: '',
      },
    ]);
  });
});
