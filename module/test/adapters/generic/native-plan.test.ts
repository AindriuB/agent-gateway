/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TASK31_NATIVE_PINS,
  task31NativePlan,
  task31ReadResult,
  task31OnceRecord,
  task31AuditRows,
  task31CleanupReady,
  task31InstalledRequest,
} from './native-plan.js';
import { validateSnapshot } from '../../../src/policy/snapshot.js';
import { task31Reconcile } from './native-reconcile.js';
import { task31NativeState } from './native-state.js';
function nativeFixture() {
  const gm: any = { id: 'gm', name: 'GM', isGM: true, active: true, targets: new Set() },
    player = { id: 'player', isGM: false },
    anchor: any = {
      id: 'setting',
      key: 'agent-gateway.auditJournalId',
      value: 'audit',
      user: null,
      _stats: { lastModifiedBy: 'gm' },
      toObject() {
        return { key: this.key, value: this.value, user: this.user, _stats: this._stats };
      },
    },
    audit: any = {
      id: 'audit',
      uuid: 'JournalEntry.audit',
      flags: { 'agent-gateway': { auditJournal: true } },
      ownership: { default: 0 },
      getUserLevel: () => 0,
      pages: { contents: [], get: () => undefined },
      toObject() {
        return { _id: this.id, flags: this.flags, ownership: this.ownership, pages: [] };
      },
    },
    collections = Object.fromEntries(
      [
        'actors',
        'items',
        'journal',
        'scenes',
        'combats',
        'tables',
        'playlists',
        'macros',
        'messages',
      ].map((k) => [
        k,
        {
          contents: k === 'journal' ? [audit] : [],
          get: (id: string) => (k === 'journal' && id === 'audit' ? audit : undefined),
        },
      ]),
    ),
    module = {
      id: 'agent-gateway',
      active: true,
      version: '0',
      documentTypes: { JournalEntryPage: { audit: {} } },
    },
    game: any = {
      ready: true,
      world: { id: 'test-world' },
      release: { generation: 13 },
      version: '13.351',
      system: { id: 'pf2e' },
      user: gm,
      users: {
        get: (id: string) => (id === 'gm' ? gm : player),
        activeGM: gm,
        filter: () => [gm],
        some: (fn: any) => [gm, player].some(fn),
      },
      settings: {
        storage: {
          get: () => ({
            contents: [anchor],
            get: (id: string) => (id === anchor.id ? anchor : undefined),
          }),
        },
        get: (_ns: string, key: string) =>
          key === 'worldPolicySnapshotMigrated'
            ? false
            : key === 'auditJournalId'
              ? 'audit'
              : key === 'folderAllowlist'
                ? { gmAgents: [], playerAgents: [] }
                : { gmAgents: { read: 'allow', write: 'ask_owner' } },
      },
      modules: { contents: [module], get: () => module },
      time: { worldTime: 0 },
      documentTypes: { JournalEntryPage: ['agent-gateway.audit'] },
      ...collections,
    };
  let raw: string | null = null;
  const context: any = {
    game,
    canvas: {},
    ui: {},
    localStorage: { getItem: () => raw },
    CONFIG: { Actor: { documentClass: class {} } },
  };
  const callback = runInNewContext(`(${task31NativeState.toString()})`, context);
  return {
    gm,
    game,
    anchor,
    audit,
    context,
    callback,
    input: { run: '0123456789ab', generation: 13 },
    setRaw: (v: any) => {
      raw = JSON.stringify({ gm: v });
    },
  };
}
describe('Task31 bounded generic native proof', () => {
  it('bounds opt-in local TLS inspection to the approved origin with no redirects', () => {
    expect(task31InstalledRequest('https://foundry.local', 14, true)).toEqual({
      url: 'https://foundry.local/modules/agent-gateway/dist/module/main.js',
      options: { ignoreHTTPSErrors: true, maxRedirects: 0, timeout: 20000 },
    });
    expect(
      task31InstalledRequest('https://foundry13.local', 13, false).options.ignoreHTTPSErrors,
    ).toBe(false);
    for (const origin of [
      'http://foundry.local',
      'https://foundry.local:444',
      'https://elsewhere.local',
      'https://foundry13.local',
    ])
      expect(() => task31InstalledRequest(origin, 14, true)).toThrow();
  });
  it('pins runtime and fixed six-call private fixture scope', () => {
    expect(TASK31_NATIVE_PINS.source).toMatch(/^[a-f0-9]{40}$/);
    expect(TASK31_NATIVE_PINS.bundle).toMatch(/^[a-f0-9]{64}$/);
    const plan = task31NativePlan('0123456789ab', 'gm', 'Actor.a');
    expect(plan).toMatchObject({
      fixtureCount: 1,
      toolRequests: 6,
      retainedAudits: 2,
      actor: { ownership: { default: 0, gm: 3 } },
    });
    expect(plan.calls.map((c) => c.name)).toEqual([
      'actor_summary',
      'actions_list',
      'inventory',
      'conditions',
      'action_perform',
      'conditions',
    ]);
    expect(plan.calls[5]!.args).toEqual({
      actorUuid: 'Actor.a',
      change: { id: 'Task31-0123456789ab-unsupported', active: true, value: 1 },
    });
    expect(() => task31NativePlan('bad', 'gm')).toThrow();
    expect(() => task31NativePlan('0123456789ab', 'gm', 'Compendium.actor')).toThrow();
  });
  it('verifies exact generic identity and explicit unsupported read shapes', () => {
    const created = { uuid: 'Actor.a', source: { name: 'Hero', img: 'icons/a.svg' } };
    const payloads = [
      {
        actorUuid: 'Actor.a',
        systemId: 'pf2e',
        name: 'Hero',
        img: 'icons/a.svg',
        type: 'npc',
        attributes: [],
      },
      { actorUuid: 'Actor.a', systemId: 'pf2e', supported: false, actions: [] },
      { actorUuid: 'Actor.a', systemId: 'pf2e', supported: false, items: [], totals: [] },
      { actorUuid: 'Actor.a', systemId: 'pf2e', supported: false, conditions: [] },
    ];
    for (const [index, data] of payloads.entries())
      expect(task31ReadResult(index, { structuredContent: data }, created)).toEqual(data);
    expect(() =>
      task31ReadResult(0, { structuredContent: { ...payloads[0], systemId: 'other' } }, created),
    ).toThrow();
    expect(() =>
      task31ReadResult(1, { structuredContent: { ...payloads[1], supported: true } }, created),
    ).toThrow();
    expect(() => task31ReadResult(0, { isError: true }, created)).toThrow();
  });
  it('requires native once approval and a stored execution failure for the exact args', () => {
    const spec = task31NativePlan('0123456789ab', 'gm', 'Actor.a').calls[4]!;
    const row = {
      tool: spec.name,
      args: spec.args,
      category: 'write',
      approver: 'owner',
      agentId: 'agent',
      status: 'approved',
      scope: 'once',
      resolvedBy: 'GM',
      result: { failed: true, text: 'INVALID_ARGS: Operation not supported for pf2e' },
    };
    expect(task31OnceRecord(row, spec, 'GM', 'agent')).toBe(row);
    for (const update of [
      { scope: 'session' },
      { category: 'read' },
      { resolvedBy: 'someone' },
      { result: { failed: false, text: 'done' } },
      { args: { actorUuid: 'Actor.other' } },
      { status: 'denied' },
    ])
      expect(() => task31OnceRecord({ ...row, ...update }, spec, 'GM', 'agent')).toThrow();
  });
  it('requires two exact failed audits with unmodified native before snapshots', () => {
    const plan = task31NativePlan('0123456789ab', 'gm', 'Actor.a'),
      created = { uuid: 'Actor.a', source: { name: 'Hero', _stats: { modifiedTime: 42 } } };
    const rows = plan.calls.slice(4).map((spec) => ({
      tool: spec.name,
      args: JSON.stringify(spec.args),
      status: 'error',
      result: 'INVALID_ARGS: Operation not supported for pf2e',
      argsTruncated: false,
      targetsDropped: 0,
      relayed: false,
      category: 'write',
      userId: 'gm',
      agentId: 'agent',
      targets: [
        { uuid: created.uuid, before: JSON.stringify(created.source), afterModifiedTime: 42 },
      ],
    }));
    expect(task31AuditRows(rows, plan, created, 'gm', 'agent')).toBe(rows);
    for (const before of [
      created.source,
      'not-json',
      'x'.repeat(200001),
      JSON.stringify({ ...created.source, name: 'changed' }),
    ])
      expect(() =>
        task31AuditRows(
          [{ ...rows[0], targets: [{ ...rows[0]!.targets[0], before }] }, rows[1]],
          plan,
          created,
          'gm',
          'agent',
        ),
      ).toThrow();
    expect(() =>
      task31AuditRows(
        [{ ...rows[0], targets: [{ ...rows[0]!.targets[0], afterModifiedTime: 43 }] }, rows[1]],
        plan,
        created,
        'gm',
        'agent',
      ),
    ).toThrow();
    expect(() => task31AuditRows(rows.slice(0, 1), plan, created, 'gm', 'agent')).toThrow();
    expect(() =>
      task31AuditRows([{ ...rows[0], status: 'ok' }, rows[1]], plan, created, 'gm', 'agent'),
    ).toThrow();
    expect(() =>
      task31AuditRows([{ ...rows[0], targets: [] }, rows[1]], plan, created, 'gm', 'agent'),
    ).toThrow();
  });
  it('serialized state uses canonical sole GM, PF2e, exact policy and migrated envelope', async () => {
    const f = nativeFixture();
    const policy = {
      version: 1,
      world: { gmAgents: { read: 'allow', write: 'ask_owner' } },
      folders: { gmAgents: [], playerAgents: [] },
    };
    const record: any = {
      id: 'policy',
      key: 'agent-gateway.worldPolicy',
      user: null,
      value: policy,
      _source: {
        _id: 'policy',
        key: 'agent-gateway.worldPolicy',
        user: null,
        value: JSON.stringify(policy),
      },
    };
    record.toObject = () => record._source;
    const latch: any = {
      id: 'latch',
      key: 'agent-gateway.worldPolicySnapshotMigrated',
      user: null,
      value: true,
      _source: {
        _id: 'latch',
        key: 'agent-gateway.worldPolicySnapshotMigrated',
        user: null,
        value: 'true',
      },
    };
    latch.toObject = () => latch._source;
    const oldGet = f.game.settings.get;
    f.game.settings.get = (ns: string, key: string) =>
      key === 'worldPolicy'
        ? policy
        : key === 'worldPolicySnapshotMigrated'
          ? true
          : oldGet(ns, key);
    f.game.settings.storage.get = () => ({
      contents: [f.anchor, record, latch],
      get: (id: string) => (id === record.id ? record : id === latch.id ? latch : f.anchor),
    });
    const baseline = await f.callback({ ...f.input, op: 'baseline' });
    expect(baseline.gm.id).toBe('gm');
    f.game.settings.storage.get = () => ({
      contents: [f.anchor, record],
      get: (id: string) => (id === record.id ? record : f.anchor),
    });
    await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow('migration authority');
    f.game.user = { ...f.gm };
    await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow('canonical');
  });
  it('refuses unsupported readiness before fixture creation', async () => {
    const f = nativeFixture();
    f.game.system.id = 'dnd5e';
    await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow('generic PF2e');
    f.game.system.id = 'pf2e';
    f.game.settings.get = (_ns: string, key: string) =>
      key === 'worldPolicySnapshotMigrated'
        ? false
        : key === 'auditJournalId'
          ? 'audit'
          : key === 'folderAllowlist'
            ? { gmAgents: [] }
            : { gmAgents: { read: 'allow', write: 'allow' } };
    await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow('ask_owner');
  });
  it('refuses restricted folders, duplicate records and stricter owner policy before creating', async () => {
    for (const scenario of [
      'folders',
      'owner',
      'duplicates',
      'shadow',
      'migration',
      'nestedOwner',
    ]) {
      const f = nativeFixture(),
        original = f.game.settings.get;
      let creates = 0;
      f.context.CONFIG.Actor.documentClass.create = async () => {
        creates++;
      };
      if (scenario === 'nestedOwner')
        f.game.settings.get = (ns: string, key: string) =>
          key === 'ownerPolicy'
            ? { gmAgents: JSON.stringify({ read: 'deny', write: 'ask_gm' }) }
            : original(ns, key);
      else if (scenario === 'migration')
        f.game.settings.get = (ns: string, key: string) =>
          key === 'worldPolicySnapshotMigrated' ? true : original(ns, key);
      else if (scenario === 'shadow')
        f.game.settings.storage.get = () => ({
          contents: [
            { key: 'other', _source: { key: 'agent-gateway.worldPolicy' } },
            { key: 'agent-gateway.worldPolicy' },
          ],
        });
      else if (scenario === 'duplicates')
        f.game.settings.storage.get = () => ({
          contents: [{ key: 'agent-gateway.worldPolicy' }, { key: 'agent-gateway.worldPolicy' }],
        });
      else
        f.game.settings.get = (ns: string, key: string) =>
          key === (scenario === 'folders' ? 'folderAllowlist' : 'ownerPolicy')
            ? scenario === 'folders'
              ? { gmAgents: ['private'] }
              : { gmAgents: { read: 'allow', write: 'ask_gm' } }
            : original(ns, key);
      await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow();
      expect(creates).toBe(0);
    }
  });
  it('rejects malformed complete envelope using the production validator before fixture admission', () => {
    const policy: any = {
      version: 1,
      world: {
        playerAgents: { read: 'allow', write: 'ask_owner', destructive: 'ask_gm', code: 'ask_gm' },
        gmAgents: {
          read: 'allow',
          write: 'ask_owner',
          destructive: 'ask_owner',
          code: 'ask_owner',
        },
      },
      playerEnabled: true,
      headlessEnabled: false,
      folders: { playerAgents: [], gmAgents: [] },
      limits: {
        playerAgents: { read: 60, write: 10 },
        gmAgents: { read: 60, write: 10 },
        agents: {},
      },
    };
    expect(validateSnapshot(policy).folders.gmAgents).toEqual([]);
    expect(() =>
      validateSnapshot({ ...policy, limits: { ...policy.limits, agents: null } }),
    ).toThrow();
    expect(() =>
      validateSnapshot({ ...policy, world: { gmAgents: policy.world.gmAgents } }),
    ).toThrow();
    expect(() => validateSnapshot({ ...policy, unknown: true })).toThrow();
  });
  it('fences fixture cleanup while a tracked request can still reach approval', () => {
    expect(task31CleanupReady(1, [{ terminal: false }])).toBe(false);
    expect(task31CleanupReady(0, [{ terminal: false }])).toBe(false);
    expect(task31CleanupReady(1, [{ terminal: true }])).toBe(false);
    expect(task31CleanupReady(0, [{ terminal: true }])).toBe(true);
  });
  it('retains returned Actor identity even when privacy postconditions fail', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' }),
      plan = task31NativePlan(f.input.run, 'gm');
    const actor: any = {
      id: 'created',
      uuid: 'Actor.created',
      documentName: 'Actor',
      flags: { world: { task31: f.input.run } },
      name: plan.actor.name,
      type: 'npc',
      items: { size: 0 },
      effects: { size: 0 },
      ownership: { default: 3 },
      toObject: () => ({ name: plan.actor.name }),
    };
    f.context.CONFIG.Actor.documentClass.create = async () => {
      f.game.actors.contents.push(actor);
      f.game.actors.get = (id: string) => (id === actor.id ? actor : undefined);
      return actor;
    };
    await expect(f.callback({ ...f.input, baseline, plan, op: 'create' })).rejects.toThrow(
      'postcondition',
    );
    expect(await f.callback({ ...f.input, op: 'createdCandidate' })).toEqual({
      uuid: 'Actor.created',
      validated: false,
    });
    await expect(
      f.callback({ ...f.input, baseline, plan, uuid: actor.uuid, op: 'cleanup' }),
    ).rejects.toThrow('custody');
  });
  it('reconciles exact persisted once records and audits read-only after cleanup', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' });
    const reconcile = runInNewContext(`(${task31Reconcile.toString()})`, f.context);
    const records = [
      { id: 'a', status: 'approved', result: { failed: true } },
      { id: 'b', status: 'approved', result: { failed: true } },
    ];
    f.setRaw(records);
    f.audit.pages.contents = [
      {
        id: 'new1',
        uuid: 'JournalEntry.audit.JournalEntryPage.new1',
        system: { toObject: () => ({ tool: 'action_perform' }) },
      },
      {
        id: 'new2',
        uuid: 'JournalEntry.audit.JournalEntryPage.new2',
        system: { toObject: () => ({ tool: 'conditions' }) },
      },
    ];
    const input = { ...f.input, baseline, created: { uuid: 'Actor.absent' }, ids: ['a', 'b'] };
    expect(reconcile(input)).toMatchObject({
      fixtureAbsent: true,
      originalSourcesUnchanged: true,
      records,
    });
    f.setRaw([...records, { id: 'later', status: 'pending' }]);
    expect(() => reconcile(input)).toThrow('Unsettled');
    f.setRaw(records);
    f.game.time.worldTime = 1;
    expect(() => reconcile(input)).toThrow('canonical');
  });
  it('reconciliation serializes through actual tsx without injected closures', () => {
    const source = fileURLToPath(new URL('./native-reconcile.ts', import.meta.url));
    const serialized = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import {task31Reconcile} from ${JSON.stringify(source)};process.stdout.write(task31Reconcile.toString());`,
      ],
      { encoding: 'utf8' },
    );
    const callback = runInNewContext(`(${serialized})`, {});
    expect(() => callback({ baseline: {} })).toThrow();
    expect(serialized).not.toContain('__name');
  });
  it('actual tsx serialization has no injected closure dependency', async () => {
    const source = fileURLToPath(new URL('./native-state.ts', import.meta.url));
    const serialized = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `import {task31NativeState} from ${JSON.stringify(source)};process.stdout.write(task31NativeState.toString());`,
      ],
      { encoding: 'utf8' },
    );
    const f = nativeFixture(),
      callback = runInNewContext(`(${serialized})`, f.context);
    expect((await callback({ ...f.input, op: 'baseline' })).gm.id).toBe('gm');
  });
});
