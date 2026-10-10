/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AuditRecord, AuditTarget } from '../../src/audit/types.js';

export interface FakeStore {
  docs: Map<string, any>;
  fromUuid: (uuid: string) => Promise<any>;
  add: (doc: any) => any;
}

/** A writable fake of a Foundry document: tracks update and delete calls. */
export function writable(
  uuid: string,
  data: Record<string, unknown>,
  modifiedTime = 1,
  store?: FakeStore,
) {
  const calls: { update: Array<{ data: any; opts: any }>; deleted: number } = {
    update: [],
    deleted: 0,
  };
  const doc: any = {
    uuid,
    id: uuid.split('.').pop(),
    data,
    calls,
    _stats: { modifiedTime },
    constructor: { metadata: { embedded: { Item: 'items' } } },
    toObject: () => JSON.parse(JSON.stringify({ _id: doc.id, ...doc.data, _stats: doc._stats })),
    async update(d: any, opts: any) {
      calls.update.push({ data: d, opts });
      Object.assign(doc.data, d);
    },
    async delete() {
      calls.deleted += 1;
      store?.docs.delete(uuid);
    },
  };
  return doc;
}

export function makeStore(): FakeStore {
  const docs = new Map<string, any>();
  return {
    docs,
    fromUuid: async (uuid) => docs.get(uuid) ?? null,
    add: (doc) => (docs.set(doc.uuid, doc), doc),
  };
}

export const target = (over: Partial<AuditTarget> = {}): AuditTarget => ({
  uuid: 'Actor.a1',
  existed: true,
  before: { name: 'Old' },
  existsAfter: true,
  afterModifiedTime: 10,
  undoable: true,
  changedPaths: [],
  note: '',
  ...over,
});

export const record = (over: Partial<AuditRecord> = {}): AuditRecord => ({
  entryId: 'entry-0000001',
  timestamp: 1000,
  userId: 'p1',
  agentId: 'agent-1',
  tool: 'fixture_write',
  category: 'write',
  args: '{"x":1}',
  argsTruncated: false,
  targets: [],
  targetsDropped: 0,
  result: 'ok',
  status: 'ok',
  relayed: false,
  ...over,
});
