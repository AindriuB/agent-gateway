/* eslint-disable @typescript-eslint/no-explicit-any */
import { savePolicyForm } from '../../src/apps/policy/index.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_MATRIX, DENY_ALL_MATRIX } from '../../src/policy/matrix.js';
import { DEFAULT_LIMITS, resolveLimit } from '../../src/ratelimit/config.js';
import { loadRateLimits } from '../../src/ratelimit/store.js';
import { folderAllowed } from '../../src/policy/folders.js';
import { liveInputs } from '../../src/policy/stage.js';
import { evaluate } from '../../src/policy/evaluate.js';
import {
  publishWorldSnapshot,
  readWorldSnapshot,
  validateSnapshot,
  type WorldSnapshot,
} from '../../src/policy/snapshot.js';

const NS = 'agent-gateway';
const proposal = (enabled = true): WorldSnapshot => ({
  version: 1,
  world: structuredClone(enabled ? DEFAULT_WORLD_MATRIX : DENY_ALL_MATRIX),
  playerEnabled: enabled,
  headlessEnabled: enabled,
  folders: { playerAgents: enabled ? ['F'] : [], gmAgents: enabled ? ['F'] : [] },
  limits: {
    ...structuredClone(DEFAULT_LIMITS),
    playerAgents: { read: enabled ? 7 : 3, write: enabled ? 2 : 1 },
  },
});
const savedGame = (globalThis as any).game;
const savedUI = (globalThis as any).ui;
let owners: Map<string, unknown>;
const contexts = new AsyncLocalStorage<any>();
let docs: any[];
let sequence = 0;
let before: (client: string, key: string, value: unknown) => Promise<void>;
let after: (client: string, key: string, value: unknown) => Promise<void>;
const defaultValue = (key: string) =>
  ({
    worldPolicy: JSON.stringify(DEFAULT_WORLD_MATRIX),
    worldPolicySnapshotMigrated: false,
    playerAgentsEnabled: true,
    headlessAgentsEnabled: false,
    folderAllowlist: JSON.stringify({ playerAgents: [], gmAgents: [] }),
    rateLimits: JSON.stringify(DEFAULT_LIMITS),
  })[key];
function setup(migrated = true) {
  docs = [];
  owners = new Map();
  (globalThis as any).ui = { notifications: { info: () => {}, error: () => {} } };
  sequence = 0;
  before = after = async () => {};
  if (migrated) {
    put('worldPolicySnapshotMigrated', true);
    put('worldPolicy', JSON.stringify(proposal()));
  }
  Object.defineProperty(globalThis, 'game', { configurable: true, get: () => contexts.getStore() });
}
function put(key: string, value: unknown, create = false) {
  let doc = create ? undefined : docs.find((d) => d.key === `${NS}.${key}`);
  if (!doc) {
    doc = { id: `s${sequence++}`, key: `${NS}.${key}`, user: null };
    docs.push(doc);
  }
  doc.value = value;
  doc._source = { _id: doc.id, key: doc.key, user: null, value: JSON.stringify(value) };
}
function client(id: string) {
  return {
    user: { id, isGM: true },
    folders: { contents: [{ id: 'F', name: 'F' }] },
    i18n: { localize: (key: string) => key },
    settings: {
      storage: new Map([
        [
          'world',
          {
            get: (id: string) => docs.find((doc) => doc.id === id),
            get contents() {
              return docs;
            },
          },
        ],
      ]),
      get: (_ns: string, key: string) =>
        key === 'ownerPolicy'
          ? owners.get(id)
          : (docs.find((d) => d.key === `${NS}.${key}`)?.value ?? defaultValue(key)),
      set: async (_ns: string, key: string, value: unknown) => {
        const absent = !docs.some((d) => d.key === `${NS}.${key}`);
        await before(id, key, value);
        if (key === 'ownerPolicy') owners.set(id, value);
        else put(key, value, absent);
        await after(id, key, value);
      },
    },
  };
}
const run = <T>(id: string, fn: () => T) => contexts.run(client(id), fn);
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function observed() {
  const snapshot = readWorldSnapshot();
  if (!snapshot.valid) return 'denied';
  const inputs = liveInputs();
  const decision = evaluate(inputs, { isGM: false, headless: false, category: 'read' });
  return {
    snapshot: validateSnapshot(snapshotPayload(snapshot)),
    decision: decision.kind === 'decision' ? decision.decision : decision.kind,
    inside: folderAllowed({ folder: { id: 'F' } }, false),
    outside: folderAllowed({ folder: { id: 'outside' } }, false),
    rate: resolveLimit(loadRateLimits(), 'playerAgents', 'agent', 'read'),
  };
}
const snapshotPayload = ({
  version,
  world,
  playerEnabled,
  headlessEnabled,
  folders,
  limits,
}: WorldSnapshot) => ({ version, world, playerEnabled, headlessEnabled, folders, limits });
afterEach(() => {
  (globalThis as any).ui = savedUI;
  Object.defineProperty(globalThis, 'game', {
    configurable: true,
    writable: true,
    value: savedGame,
  });
});

describe('whole world publication across independent GM clients', () => {
  it.each(['A', 'B'])(
    'last complete writer wins when %s pauses before publication',
    async (paused) => {
      setup();
      const gate = deferred();
      const entered = deferred();
      const history: any[] = [];
      before = async (id, key) => {
        if (id === paused && key === 'worldPolicy') {
          entered.resolve();
          await gate.promise;
        }
      };
      after = async (_id, key) => {
        if (key === 'worldPolicy') history.push(observed());
      };
      const pa = proposal(true),
        pb = proposal(false);
      const first = run(paused, () => publishWorldSnapshot(paused === 'A' ? pa : pb));
      await entered.promise;
      await run(paused === 'A' ? 'B' : 'A', () => publishWorldSnapshot(paused === 'A' ? pb : pa));
      gate.resolve();
      await first;
      expect(history.map((row) => row.snapshot)).toEqual(paused === 'A' ? [pb, pa] : [pa, pb]);
      for (const row of history) {
        expect(row.rate).toBe(row.snapshot.playerEnabled ? 7 : 3);
        expect(row.outside).toBe(!row.snapshot.playerEnabled);
        expect(row.decision).toBe(row.snapshot.playerEnabled ? 'allow' : 'disabled');
      }
    },
  );
  it('never compensates an apply-then-reject publication over another GM winner', async () => {
    setup();
    const gate = deferred();
    const entered = deferred();
    after = async (id, key) => {
      if (id === 'A' && key === 'worldPolicy') {
        entered.resolve();
        await gate.promise;
        throw Error('Lost acknowledgement');
      }
    };
    const a = run('A', () => publishWorldSnapshot(proposal(true)));
    const rejected = expect(a).rejects.toThrow('Lost acknowledgement');
    await entered.promise;
    await run('B', () => publishWorldSnapshot(proposal(false)));
    gate.resolve();
    await rejected;
    expect(run('B', readWorldSnapshot).playerEnabled).toBe(false);
  });
  it('concurrent first creates remain denied when backend keys are not unique', async () => {
    setup(false);
    put('worldPolicySnapshotMigrated', true);
    const gate = deferred();
    let arrivals = 0;
    const ready = deferred();
    before = async (_id, key) => {
      if (key === 'worldPolicy') {
        if (++arrivals === 2) ready.resolve();
        await gate.promise;
      }
    };
    const results = Promise.allSettled([
      run('A', () => publishWorldSnapshot(proposal())),
      run('B', () => publishWorldSnapshot(proposal(false))),
    ]);
    await ready.promise;
    gate.resolve();
    await results;
    expect(docs.filter((d) => d.key === `${NS}.worldPolicy`)).toHaveLength(2);
    expect(run('A', readWorldSnapshot).valid).toBe(false);
    await expect(run('A', () => publishWorldSnapshot(proposal()))).rejects.toThrow('repair');
  });
  it('concurrent latch creation cannot choose an arbitrary latch record', async () => {
    setup(false);
    const gate = deferred();
    const ready = deferred();
    let arrivals = 0;
    before = async (_id, key) => {
      if (key === 'worldPolicySnapshotMigrated') {
        if (++arrivals === 2) ready.resolve();
        await gate.promise;
      }
    };
    const results = Promise.allSettled([
      run('A', () => publishWorldSnapshot(proposal())),
      run('B', () => publishWorldSnapshot(proposal(false))),
    ]);
    await ready.promise;
    gate.resolve();
    expect((await results).every((r) => r.status === 'rejected')).toBe(true);
    expect(run('A', readWorldSnapshot).valid).toBe(false);
    expect(docs.some((d) => d.key === `${NS}.worldPolicy`)).toBe(false);
  });
});

describe('migration and fail-closed records', () => {
  it('reads valid legacy state, migrates once, and ignores legacy mirrors thereafter', async () => {
    setup(false);
    expect(run('A', readWorldSnapshot).valid).toBe(true);
    await run('A', () => publishWorldSnapshot(proposal()));
    put('folderAllowlist', JSON.stringify({ playerAgents: [], gmAgents: [] }));
    put('rateLimits', JSON.stringify(DEFAULT_LIMITS));
    put('playerAgentsEnabled', false);
    expect(run('A', readWorldSnapshot).folders.playerAgents).toEqual(['F']);
    expect(run('A', readWorldSnapshot).playerEnabled).toBe(true);
  });
  it.each(['before', 'after'])(
    'latch %s-apply rejection never resets migration or publishes world',
    async (phase) => {
      setup(false);
      const hook = async (_id: string, key: string) => {
        if (key === 'worldPolicySnapshotMigrated') throw Error('Latch failure');
      };
      if (phase === 'before') before = hook;
      else after = hook;
      await expect(run('A', () => publishWorldSnapshot(proposal()))).rejects.toThrow();
      expect(docs.some((d) => d.key === `${NS}.worldPolicy`)).toBe(false);
      expect(docs.find((d) => d.key.endsWith('Migrated'))?.value).toBe(
        phase === 'after' ? true : undefined,
      );
      if (phase === 'after') expect(run('A', readWorldSnapshot).valid).toBe(false);
    },
  );
  it.each([
    undefined,
    JSON.stringify(DEFAULT_WORLD_MATRIX),
    JSON.stringify({ ...proposal(), version: 2 }),
    JSON.stringify({ ...proposal(), playerEnabled: 'yes' }),
    JSON.stringify({ ...proposal(), limits: { ...DEFAULT_LIMITS, agents: 'damaged' } }),
  ])('denies missing/downgraded/corrupt migrated state %s', (raw) => {
    setup();
    docs = docs.filter((d) => !d.key.endsWith('.worldPolicy'));
    if (raw !== undefined) put('worldPolicy', raw);
    expect(run('A', readWorldSnapshot).valid).toBe(false);
    expect(run('A', () => resolveLimit(loadRateLimits(), 'playerAgents', 'a', 'read'))).toBe(1);
  });
  it.each(['user', 'key', 'duplicate', 'unreadable', 'latch'])(
    'denies inconsistent %s identity/storage',
    (kind) => {
      setup();
      const doc = docs.find((d) => d.key.endsWith('.worldPolicy'));
      if (kind === 'user') doc.user = 'player';
      if (kind === 'key') doc.key = 'other';
      if (kind === 'duplicate') docs.push({ ...doc, id: 'other' });
      if (kind === 'latch') docs[0].value = 'true';
      const c = client('A');
      if (kind === 'unreadable') c.settings.storage.clear();
      expect(contexts.run(c, readWorldSnapshot).valid).toBe(false);
    },
  );
  it('returns copied admitted state and preserves special agent IDs', async () => {
    setup();
    const p = proposal();
    p.limits.agents = JSON.parse('{"__proto__":{"read":2}}');
    await run('A', () => publishWorldSnapshot(p));
    const read = run('A', readWorldSnapshot);
    read.folders.playerAgents.length = 0;
    read.world.playerAgents.read = 'deny';
    expect(run('A', readWorldSnapshot).folders.playerAgents).toEqual(['F']);
    expect(
      run('A', () => resolveLimit(loadRateLimits(), 'playerAgents', '__proto__', 'read')),
    ).toBe(2);
  });
});

it.each(['cached', 'sourceValue', 'sourceId', 'missingValue', 'nonstringValue'])(
  'rejects %s inconsistent persisted state',
  (kind) => {
    setup();
    const c = client('A');
    const doc = docs.find((d) => d.key.endsWith('.worldPolicy'));
    if (kind === 'cached') {
      const get = c.settings.get;
      c.settings.get = (ns, key) =>
        key === 'worldPolicy' ? JSON.stringify(proposal(false)) : get(ns, key);
    }
    if (kind === 'sourceValue') doc._source.value = JSON.stringify(JSON.stringify(proposal(false)));
    if (kind === 'sourceId') doc._source._id = 'different';
    if (kind === 'missingValue') delete doc._source.value;
    if (kind === 'nonstringValue') doc._source.value = proposal();
    expect(contexts.run(c, readWorldSnapshot).valid).toBe(false);
  },
);

it.each(['world', 'playerEnabled', 'headlessEnabled', 'folders', 'limits'])(
  'rejects a missing migrated %s field',
  (field) => {
    setup();
    const p: any = proposal();
    delete p[field];
    put('worldPolicy', JSON.stringify(p));
    expect(run('A', readWorldSnapshot).valid).toBe(false);
  },
);

it('does not publish world after first latch acknowledgement fails, and never resets the latch', async () => {
  setup(false);
  after = async (_id, key) => {
    if (key === 'worldPolicySnapshotMigrated') throw Error('Ack');
  };
  await expect(run('A', () => publishWorldSnapshot(proposal()))).rejects.toThrow('Ack');
  expect(docs.map((d) => [d.key, d.value])).toEqual([[`${NS}.worldPolicySnapshotMigrated`, true]]);
});

it('fails before world write if role changes during latch persistence', async () => {
  setup(false);
  after = async (_id, key) => {
    if (key === 'worldPolicySnapshotMigrated') contexts.getStore().user.isGM = false;
  };
  await expect(run('A', () => publishWorldSnapshot(proposal()))).rejects.toThrow('GM');
  expect(docs.some((d) => d.key.endsWith('.worldPolicy'))).toBe(false);
});

it.each(['missingSource', 'noncanonical', 'falseLatch'])(
  'denies %s persisted authority',
  (kind) => {
    setup();
    const c = client('A');
    const doc = docs.find((d) => d.key.endsWith('.worldPolicy'));
    if (kind === 'missingSource') delete doc._source;
    if (kind === 'noncanonical')
      c.settings.storage.set('world', { contents: docs, get: () => ({ ...doc }) } as any);
    if (kind === 'falseLatch') put('worldPolicySnapshotMigrated', false);
    expect(contexts.run(c, readWorldSnapshot).valid).toBe(false);
  },
);

it.each(['A', 'B'])(
  'actual two-GM form saves publish whole proposals when %s waits',
  async (paused) => {
    setup();
    const gate = deferred();
    const entered = deferred();
    const history: WorldSnapshot[] = [];
    const pa = proposal(true),
      pb = proposal(false);
    const form = (p: WorldSnapshot) => {
      const out: Record<string, unknown> = {
        playerEnabled: p.playerEnabled,
        headlessEnabled: p.headlessEnabled,
      };
      for (const cls of ['playerAgents', 'gmAgents'] as const) {
        for (const cat of ['read', 'write', 'destructive', 'code'] as const) {
          out[`world_${cls}_${cat}`] = p.world[cls][cat];
          out[`owner_${cls}_${cat}`] = p.world[cls][cat];
        }
        out[`folders_${cls}`] = p.folders[cls];
        out[`limits_${cls}_read`] = p.limits[cls].read;
        out[`limits_${cls}_write`] = p.limits[cls].write;
      }
      return out;
    };
    before = async (id, key) => {
      if (id === paused && key === 'worldPolicy') {
        entered.resolve();
        await gate.promise;
      }
    };
    after = async (_id, key) => {
      if (key === 'worldPolicy') history.push(snapshotPayload(readWorldSnapshot()));
    };
    const first = run(paused, () => savePolicyForm(form(paused === 'A' ? pa : pb)));
    await entered.promise;
    expect(
      await run(paused === 'A' ? 'B' : 'A', () => savePolicyForm(form(paused === 'A' ? pb : pa))),
    ).toBe(true);
    gate.resolve();
    expect(await first).toBe(true);
    expect(history).toEqual(paused === 'A' ? [pb, pa] : [pa, pb]);
    expect(owners.size).toBe(2);
  },
);
