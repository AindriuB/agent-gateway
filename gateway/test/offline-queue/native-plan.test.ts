/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TASK30_PINS,
  task30Plan,
  task30Receipt,
  task30Status,
  task30Attestation,
  task30SafePhase,
  task30AwaitPending,
  TASK30_PENDING_MS,
  task30TeardownFailure,
} from './native-plan.js';
import { task30NativeState, task30PreloadTemplate, task30RecoverCustody } from './native-state.js';
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
          key === 'auditJournalId' ? 'audit' : { gmAgents: { write: 'ask_owner' } },
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
  const callback = runInNewContext(`(${task30NativeState.toString()})`, context);
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
describe('Task30 exact native queue acceptance scope', () => {
  it('pins reviewed protocol6 source/build and exactly one private fixture/two requests/one audit', () => {
    expect(TASK30_PINS.source).toMatch(/^[a-f0-9]{40}$/);
    expect(TASK30_PINS.bundle).toMatch(/^[a-f0-9]{64}$/);
    const p = task30Plan('0123456789ab', 'gm');
    expect(p).toMatchObject({
      fixtureCount: 1,
      toolRequests: 2,
      retainedAudits: 1,
      actor: { ownership: { default: 0, gm: 3 } },
    });
    expect(p.names).toHaveLength(2);
    expect(() => task30Plan('bad', 'gm')).toThrow();
  });
  it('accepts only exact receipt identity and expected status', () => {
    const id = 'a'.repeat(32);
    expect(task30Receipt({ status: 'pending_approval', id })).toBe(id);
    expect(() => task30Receipt({ status: 'queued', id })).toThrow();
    expect(() => task30Receipt({ status: 'pending_approval', id: ['a'] })).toThrow();
    expect(task30Status({ id, status: 'queued' }, id, 'queued')).toEqual({ id, status: 'queued' });
    expect(() => task30Status({ id, status: 'approved' }, id, 'queued')).toThrow();
  });
  it('serialized baseline works without imported closures and reads the migrated envelope', async () => {
    const f = nativeFixture();
    f.game.settings.get = (_n: string, k: string) =>
      k === 'auditJournalId' ? 'audit' : { version: 1, world: { gmAgents: { write: 'allow' } } };
    const b = await f.callback({ ...f.input, op: 'baseline' });
    expect(b.gm.id).toBe('gm');
    expect(b.auditId).toBe('audit');
    expect(b.sources).toHaveLength(1);
  });
  it('rejects deny before creating any fixture', async () => {
    const f = nativeFixture();
    f.game.settings.get = (_n: string, k: string) =>
      k === 'auditJournalId' ? 'audit' : { gmAgents: { write: 'deny' } };
    await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow('disabled');
    expect(f.game.actors.contents).toEqual([]);
  });
  it('rejects noncanonical identity and undeclared/public audit', async () => {
    for (const corrupt of [
      (f: any) => {
        f.game.user = { ...f.gm };
      },
      (f: any) => {
        f.audit.ownership.default = 1;
      },
      (f: any) => {
        f.game.modules.get().documentTypes = {};
      },
      (f: any) => {
        f.anchor._stats.lastModifiedBy = 'player';
      },
    ]) {
      const f = nativeFixture();
      corrupt(f);
      await expect(f.callback({ ...f.input, op: 'baseline' })).rejects.toThrow();
    }
  });
  it('permits only run receipt IDs while pending, refusing cleanup until terminal', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' });
    f.setRaw([{ id: 'own', status: 'pending' }]);
    await expect(f.callback({ ...f.input, baseline, ids: [], op: 'queue' })).rejects.toThrow(
      'Unrelated',
    );
    await expect(f.callback({ ...f.input, baseline, ids: ['own'], op: 'cleanup' })).rejects.toThrow(
      'Pending replay',
    );
    expect((await f.callback({ ...f.input, baseline, ids: ['own'], op: 'queue' })).length).toBe(1);
  });
  it('fails original settings/source drift before cleanup', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' });
    f.anchor.value = 'changed';
    await expect(f.callback({ ...f.input, baseline, op: 'cleanup' })).rejects.toThrow();
  });
  it('serialized template preload only writes the reviewed cache', async () => {
    const partials: any = {},
      compile = (s: string) => () => s;
    const callback = runInNewContext(`(${task30PreloadTemplate.toString()})`, {
      Handlebars: { partials, compile },
    });
    await expect(callback('<article data-request="x"></article>')).resolves.toBe(true);
    expect(Object.keys(partials)).toEqual([
      'modules/agent-gateway/templates/approval/approval.hbs',
    ]);
    await expect(callback('bad')).rejects.toThrow('template');
  });
  it('records returned candidate even when native authority changes after create', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' }),
      plan = task30Plan(f.input.run, 'gm');
    class Actor {
      static async create() {
        f.gm.isGM = false;
        return { uuid: 'Actor.created' };
      }
    }
    f.context.CONFIG.Actor.documentClass = Actor;
    await expect(f.callback({ ...f.input, baseline, plan, op: 'create' })).rejects.toThrow(
      'canonical',
    );
    expect(await f.callback({ ...f.input, baseline, op: 'createdCandidate' })).toEqual({
      uuid: 'Actor.created',
      validated: false,
    });
  });
  it('records candidate without authorizing cleanup after invalid private-create postcondition', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' }),
      plan = task30Plan(f.input.run, 'gm');
    class Actor {
      static async create() {
        return { uuid: 'Actor.created' };
      }
    }
    f.context.CONFIG.Actor.documentClass = Actor;
    await expect(f.callback({ ...f.input, baseline, plan, op: 'create' })).rejects.toThrow(
      'postcondition',
    );
    expect(await f.callback({ ...f.input, baseline, op: 'createdCandidate' })).toEqual({
      uuid: 'Actor.created',
      validated: false,
    });
    await expect(
      f.callback({ ...f.input, baseline, plan, uuid: 'Actor.created', op: 'cleanup' }),
    ).rejects.toThrow('custody');
  });
  it('native attestation uses canonical GM name rather than ID', () => {
    const rows = [
      { id: 'a', status: 'approved', scope: 'once', resolvedBy: 'dev-gm' },
      { id: 'b', status: 'denied', resolvedBy: 'dev-gm', reason: 'intentional' },
    ];
    expect(() =>
      task30Attestation(rows, ['a', 'b'], 'dev-gm', 'intentional', 'intentional'),
    ).not.toThrow();
    expect(() =>
      task30Attestation(rows, ['a', 'b'], 'native-id', 'intentional', 'intentional'),
    ).toThrow();
  });
  it('attests the complete native denial reason against the receipt without normalizing punctuation', () => {
    const tag = 'Task30-218a957cec48 deliberate denial';
    const rows = [
      { id: 'a', status: 'approved', scope: 'once', resolvedBy: 'dev-gm' },
      { id: 'b', status: 'denied', resolvedBy: 'dev-gm', reason: `${tag},` },
    ];
    expect(task30Attestation(rows, ['a', 'b'], 'dev-gm', tag, `${tag},`).denied.reason).toBe(
      `${tag},`,
    );
    expect(() => task30Attestation(rows, ['a', 'b'], 'dev-gm', tag, tag)).toThrow();
    for (const reason of ['', 'Task30-wrong deliberate denial', `${tag}${'x'.repeat(1000)}`]) {
      rows[1]!.reason = reason;
      expect(() => task30Attestation(rows, ['a', 'b'], 'dev-gm', tag, reason)).toThrow();
    }
    rows[1]!.reason = tag;
    rows[1]!.status = 'pending';
    expect(() => task30Attestation(rows, ['a', 'b'], 'dev-gm', tag, tag)).toThrow();
    rows[1]!.status = 'denied';
    rows[0]!.status = 'pending';
    expect(() => task30Attestation(rows, ['a', 'b'], 'dev-gm', tag, tag)).toThrow();
  });
  it('a rejected drain still closes subsequent owned resources and preserves failure', async () => {
    const errors: string[] = [],
      calls: string[] = [];
    await task30SafePhase(errors, 'drain', async () => {
      calls.push('drain');
      throw Error('timeout');
    });
    for (const label of ['browser', 'queue', 'events', 'store'])
      await task30SafePhase(errors, label, () => {
        calls.push(label);
      });
    expect(calls).toEqual(['drain', 'browser', 'queue', 'events', 'store']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('timeout');
  });
  it('actual tsx transpilation keeps both browser callbacks self-contained', () => {
    const url = new URL('./native-state.ts', import.meta.url).href;
    const script = `import {runInNewContext} from 'node:vm';
      const {task30NativeState,task30PreloadTemplate,task30RecoverCustody}=await import(${JSON.stringify(url)});
      const f=runInNewContext('('+task30NativeState.toString()+')',{});
      if(await f({op:'createdCandidate',run:'0123456789ab'})!==null)throw Error('candidate');
      const partials={};const p=runInNewContext('('+task30PreloadTemplate.toString()+')',{Handlebars:{partials,compile:(s)=>()=>s}});
      await p('<article data-request="x"></article>');
      if(Object.keys(partials).length!==1)throw Error('template');
      const recovery=runInNewContext('('+task30RecoverCustody.toString()+')',{game:{actors:{get:()=>undefined},settings:{storage:{get:()=>({contents:[]})}},journal:{get:()=>undefined}}});
      let rejected=false;try {recovery({created:{uuid:'Actor.fixture'},baseline:{auditId:'audit'}});}catch(e){if(!String(e).includes('Exact failed-run'))throw e;rejected=true;}
      if(!rejected)throw Error('recovery');`;
    expect(() =>
      execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        timeout: 10000,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
  it('allows the real25second approval timeout before expecting a pending receipt', async () => {
    let now = 0;
    await task30AwaitPending(() => now >= 25000, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    expect(now).toBe(25000);
    expect(TASK30_PENDING_MS).toBeGreaterThan(25000);
    now = 0;
    await expect(
      task30AwaitPending(() => false, {
        now: () => now,
        sleep: async (ms) => {
          now += ms;
        },
      }),
    ).rejects.toThrow('deadline');
    expect(now).toBe(TASK30_PENDING_MS);
  });
  it('read-only recovery admits only exact unchanged failed-run fixture and expired replay metadata', async () => {
    const f = nativeFixture(),
      baseline = await f.callback({ ...f.input, op: 'baseline' }),
      plan = task30Plan(f.input.run, 'gm');
    const data = {
      _id: 'fixture',
      name: plan.actor.name,
      type: 'npc',
      flags: plan.actor.flags,
      ownership: plan.actor.ownership,
      _stats: { modifiedTime: 12 },
    };
    class Actor {
      id = 'fixture';
      uuid = 'Actor.fixture';
      name = data.name;
      parent = null;
      pack = null;
      flags = data.flags;
      ownership = data.ownership;
      _stats = data._stats;
      toObject() {
        return structuredClone(data);
      }
      testUserPermission() {
        return false;
      }
    }
    const actor = new Actor();
    f.context.CONFIG.Actor.documentClass = Actor;
    f.game.actors.get = () => actor;
    f.setRaw([
      { id: 'a', status: 'expired', replay: true },
      { id: 'b', status: 'expired', replay: true },
    ]);
    const callback = runInNewContext('(' + task30RecoverCustody.toString() + ')', f.context);
    const input = {
      ...f.input,
      baseline,
      plan,
      ids: ['a', 'b'],
      created: { uuid: actor.uuid, source: structuredClone(data) },
    };
    expect(callback(input)).toEqual({ uuid: actor.uuid });
    data._stats.modifiedTime = 13;
    expect(() => callback(input)).toThrow('custody');
    data._stats.modifiedTime = 12;
    f.setRaw([
      { id: 'a', status: 'pending', replay: true },
      { id: 'b', status: 'expired', replay: true },
    ]);
    expect(() => callback(input)).toThrow('nonexecutable');
    f.setRaw([
      { id: 'a', status: 'expired', replay: true },
      { id: 'b', status: 'expired', replay: true },
    ]);
    f.audit.pages.contents.push({ id: 'new' });
    expect(() => callback(input)).toThrow('custody');
  });
  it('preserves the original acceptance failure while separately retaining cleanup errors', async () => {
    const primary = Error('pending status deadline'),
      secondary: string[] = [];
    const run = async () => {
      try {
        throw primary;
      } finally {
        await task30SafePhase(secondary, 'cleanup', () => {
          throw Error('fixture still pending');
        });
        task30TeardownFailure(primary, secondary);
      }
    };
    await expect(run()).rejects.toBe(primary);
    expect(secondary[0]).toContain('fixture still pending');
    expect(() => task30TeardownFailure(undefined, secondary)).toThrow('reconciliation');
  });
});
