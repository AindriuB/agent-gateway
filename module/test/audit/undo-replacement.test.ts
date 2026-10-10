/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { pageData } from '../../src/audit/journal.js';
import { undoEntry } from '../../src/audit/undo.js';
import { AuditWitness } from '../../src/audit/witness.js';
import { makeStore, record, target, writable } from './fake.js';

const plain = (v: any): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const copy = (v: any) => JSON.parse(JSON.stringify(v));

function expandUpdate(update: Record<string, any>) {
  const expanded: Record<string, any> = {};
  for (const [path, value] of Object.entries(update)) {
    const segments = path.split('.');
    let node = expanded;
    for (const segment of segments.slice(0, -1)) node = node[segment] ??= {};
    node[segments.at(-1)!] = value;
  }
  return expanded;
}

/** Model Foundry updates: expand dotted paths, recursively merge objects, apply -= deletions. */
function applyUpdate(data: Record<string, any>, update: Record<string, any>, options: any) {
  const merge = (into: Record<string, any>, change: Record<string, any>) => {
    for (const [key, value] of Object.entries(change)) {
      if (key.startsWith('-=')) delete into[key.slice(2)];
      else if (plain(value)) {
        const child = options.recursive !== false && plain(into[key]) ? into[key] : {};
        merge(child, value);
        into[key] = child;
      } else into[key] = copy(value);
    }
  };
  merge(data, expandUpdate(update));
}

const cases = [
  { path: 'state', before: { old: 1 }, after: { new: 2 } },
  { path: 'flags.mod.state', before: { old: 1 }, after: { new: 2 } },
  { path: 'flags.mod.state', before: {}, after: { new: 2 } },
  {
    path: 'flags.mod.state',
    before: { nested: { old: 1 } },
    after: { nested: { new: 2 }, extra: 3 },
  },
];

describe('witnessed object replacement undo', () => {
  it.each(cases)(
    'restores $path from $after to exactly $before, preserving unobserved siblings',
    async ({ path, before, after }) => {
      const store = makeStore();
      const initial: Record<string, any> = {
        name: 'Keep',
        flags: { mod: { sibling: { untouched: 9 } }, other: { untouched: 10 } },
      };
      applyUpdate(initial, { [path]: before }, {});
      const doc = store.add(writable('Actor.A', copy(initial), 1, store));
      doc.update = async (data: any, opts: any) => {
        doc.calls.update.push({ data, opts });
        applyUpdate(doc.data, data, opts);
      };
      const witness = new AuditWitness({
        fromUuid: store.fromUuid,
        now: () => 1,
        grace: async () => {},
      });
      const callId = 'object-replace-001';
      const options = { agentGateway: { callId } };
      await witness.onIntent({ callId, uuid: doc.uuid }, 'p1');
      const segments = path.split('.');
      const deletion = [...segments.slice(0, -1), `-=${segments.at(-1)}`].join('.');
      const remove = { [deletion]: null };
      applyUpdate(doc.data, remove, {});
      doc._stats.modifiedTime = 2;
      witness.onUpdate(doc, expandUpdate(remove), options, 'p1');
      const replace = { [path]: after };
      applyUpdate(doc.data, replace, {});
      doc._stats.modifiedTime = 3;
      witness.onUpdate(doc, expandUpdate(replace), options, 'p1');
      const assembled = await witness.assemble(
        record({ entryId: callId, relayed: true, targets: [target({ uuid: doc.uuid })] }),
        'p1',
      );
      expect(assembled.targets[0]?.undoable).toBe(true);
      const page = {
        id: 'replacement-page',
        system: pageData(assembled).system,
        update: vi.fn(async () => {}),
      };
      const out = await undoEntry(page, async () => true, {
        isGM: () => true,
        userId: () => 'gm1',
        fromUuid: store.fromUuid,
        canModify: () => true,
        now: () => 7,
      });
      expect(out).toMatchObject({ status: 'done', restored: 1 });
      expect(doc.data).toEqual(initial);
      expect(doc.calls.update).toHaveLength(1);
      expect(page.update).toHaveBeenCalledOnce();
    },
  );
});
