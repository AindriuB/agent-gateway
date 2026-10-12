/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';
import { runInNewContext } from 'node:vm';
import {
  task29Plan,
  task29Pins,
  task29SettingSequence,
  task29PostPurgeCursor,
  task29SettingCustody,
} from './offline-native-plan.js';
import {
  task29NativeState,
  task29InstallUITracking,
  task29PreloadPolicyTemplate,
} from './offline-native-state.js';

function fixture(initial = { enabled: false, retentionDays: 14 }) {
  let current = structuredClone(initial);
  const gm = { id: 'gm', isGM: true, active: true, targets: new Set() };
  const collections = Object.fromEntries(
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
    ].map((key) => [key, { contents: [], get: () => undefined }]),
  );
  const roots = Object.fromEntries(Object.keys(collections).map((key) => [key, []]));
  const views = { sceneId: null, levelId: null, targets: [], combatUuid: null, activeScenes: [] };
  const game = {
    ready: true,
    world: { id: 'test-world' },
    release: { generation: 13 },
    user: gm,
    users: {
      get: (id: string) => (id === 'gm' ? gm : undefined),
      activeGM: gm,
      filter: () => [gm],
    },
    time: { worldTime: 0 },
    ...collections,
    settings: {
      storage: { get: () => ({ contents: [] }) },
      get: () => current,
      set: async (_ns: string, _key: string, value: typeof current) => {
        current = structuredClone(value);
      },
    },
  };
  const callback = runInNewContext(`(${task29NativeState.toString()})`, {
    game,
    canvas: {},
    ui: {},
    localStorage: { getItem: () => null },
  });
  const input = {
    run: '0123456789ab',
    generation: 13,
    baseline: {
      gm: { id: 'gm' },
      worldTime: 0,
      views,
      roots,
      sources: [],
      settings: [],
      offlinePolicy: structuredClone(initial),
    },
  };
  return {
    game,
    gm,
    callback,
    input,
    current: () => current,
    change: (value: typeof current) => {
      current = value;
    },
  };
}

describe('Task29 bounded native settings and cleanup plan', () => {
  it('pins the merged source and exact bundle with one private Actor and two names', () => {
    expect(task29Pins()).toEqual({
      source: '88b27ca2b273d1f9778cc78a6e22967c2be2c9a8',
      bundle: 'd19791ab8a7e38e365c4e84a76f4615fe80b99ec64f576b34bc331bff3b99101',
    });
    const plan = task29Plan('0123456789ab', 'gm');
    expect(plan.fixtureCount).toBe(1);
    expect(plan.actor.ownership).toEqual({ default: 0, gm: 3 });
    expect(plan.names).toHaveLength(2);
    expect(task29SettingSequence).toEqual([
      { enabled: true, retentionDays: 14 },
      { enabled: false, retentionDays: 14 },
      { enabled: true, retentionDays: 14 },
    ]);
    expect(() => task29Pins('bad')).toThrow();
  });
  it('refuses invalid original settings and external changes rather than overwriting', () => {
    for (const value of [
      null,
      { enabled: true, retentionDays: 0 },
      { enabled: true, retentionDays: 366 },
      { enabled: true, retentionDays: 14, extra: true },
    ])
      expect(() => task29SettingCustody(value, value)).toThrow();
    expect(() =>
      task29SettingCustody(
        { enabled: true, retentionDays: 14 },
        { enabled: false, retentionDays: 14 },
      ),
    ).toThrow();
  });
  it('actually serialized callback restores a nondefault original policy only under exact current custody', async () => {
    const f = fixture({ enabled: false, retentionDays: 30 });
    f.change({ enabled: true, retentionDays: 14 });
    await expect(
      f.callback({
        ...f.input,
        op: 'restoreSetting',
        expectedPolicy: { enabled: true, retentionDays: 14 },
      }),
    ).resolves.toMatchObject({
      originalRestored: true,
      policy: { enabled: false, retentionDays: 30 },
    });
    expect(f.current()).toEqual({ enabled: false, retentionDays: 30 });
  });
  it('actually serialized callback refuses external policy drift without calling set', async () => {
    const f = fixture();
    let writes = 0;
    f.game.settings.set = async () => {
      writes++;
    };
    f.change({ enabled: false, retentionDays: 20 });
    await expect(
      f.callback({
        ...f.input,
        op: 'restoreSetting',
        expectedPolicy: { enabled: true, retentionDays: 14 },
      }),
    ).rejects.toThrow('no overwrite');
    expect(writes).toBe(0);
    expect(f.current()).toEqual({ enabled: false, retentionDays: 20 });
  });
  it('rechecks native authority after an awaited restore and never reports false success', async () => {
    const f = fixture();
    f.change({ enabled: true, retentionDays: 14 });
    f.game.settings.set = async () => {
      f.gm.isGM = false;
    };
    await expect(
      f.callback({
        ...f.input,
        op: 'restoreSetting',
        expectedPolicy: { enabled: true, retentionDays: 14 },
      }),
    ).rejects.toThrow('sole canonical');
  });
  it('checks setting custody before actual UI opening and fixture deletion', async () => {
    const f = fixture();
    f.change({ enabled: true, retentionDays: 14 });
    await expect(
      f.callback({
        ...f.input,
        op: 'openPolicy',
        expectedPolicy: { enabled: false, retentionDays: 14 },
      }),
    ).rejects.toThrow('custody changed');
    await expect(
      f.callback({
        ...f.input,
        op: 'cleanup',
        expectedPolicy: { enabled: true, retentionDays: 14 },
      }),
    ).rejects.toThrow('restored before fixture deletion');
  });
});

describe('actual serialized native UI settlement observer', () => {
  it('preserves the native handler receiver and waits through delayed completion/rejection', async () => {
    let settle!: () => void;
    const buttons = [
      {
        onclick: function (this: unknown) {
          expect(this).toBe(buttons[0]);
          return new Promise<void>((resolve) => {
            settle = resolve;
          });
        },
      },
      { onclick: () => Promise.reject(Error('native failure')) },
    ];
    const globals = {
      document: { querySelector: (selector: string) => buttons[selector.includes('save') ? 0 : 1] },
    } as any;
    runInNewContext(`(${task29InstallUITracking.toString()})`, globals)();
    buttons[0]!.onclick.call(buttons[0]);
    buttons[1]!.onclick.call(buttons[1]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globals.__task29UIOps).toMatchObject([
      { terminal: false, failed: false },
      { terminal: true, failed: true },
    ]);
    settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globals.__task29UIOps[0].terminal).toBe(true);
  });
});

describe('native policy template socket-cache preload', () => {
  it('uses the exact supplied snapshot and native compilation/cache APIs without replacing them', () => {
    const compiled = () => 'native result';
    const calls: unknown[] = [];
    const h = {
      partials: {} as Record<string, unknown>,
      compile: (source: string, options: unknown) => {
        calls.push({ source, options });
        return compiled;
      },
      registerPartial: (path: string, value: unknown) => {
        h.partials[path] = value;
      },
    };
    const load = runInNewContext(`(${task29PreloadPolicyTemplate.toString()})`, { Handlebars: h });
    expect(load('<form data-offline-save>exact snapshot</form>')).toEqual({
      path: 'modules/agent-gateway/templates/policy/policy.hbs',
      compiled: true,
    });
    expect(calls).toEqual([
      { source: '<form data-offline-save>exact snapshot</form>', options: { preventIndent: true } },
    ]);
    expect(h.partials['modules/agent-gateway/templates/policy/policy.hbs']).toBe(compiled);
    expect(() => load('overwrite')).toThrow('fresh native');
  });
  it('refuses unsupported or unbounded templates before any cache change', () => {
    const load = runInNewContext(`(${task29PreloadPolicyTemplate.toString()})`, {});
    expect(() => load('source')).toThrow('fresh native');
    const h = {
      partials: {},
      compile: () => {
        throw Error('should not compile');
      },
      registerPartial: () => {
        throw Error('should not write');
      },
    };
    const bounded = runInNewContext(`(${task29PreloadPolicyTemplate.toString()})`, {
      Handlebars: h,
    });
    expect(() => bounded('a'.repeat(65537))).toThrow('fresh native');
  });
});

describe('actual repository purge cursor proof', () => {
  it('uses an explicit cursor to report a purged interval without mistaking an omitted cursor for a gap', () => {
    const store = openStore(':memory:');
    const owner = { worldId: 'test', userId: 'gm', agentId: 'paired' };
    try {
      for (let seq = 1; seq <= 5; seq++)
        store.events.append(
          owner,
          { seq, ts: 1, type: 'actor_update', userId: 'gm', summary: 'Actor updated' },
          1,
        );
      expect(store.events.purge(owner.worldId)).toBe(5);
      expect(store.events.read(owner, undefined, 100)).toEqual({ events: [], nextAfter: 0 });
      const proof = store.events.read(owner, task29PostPurgeCursor.after, 100);
      expect(proof).toEqual({
        events: [],
        nextAfter: 5,
        cursorGap: { after: 0, firstAvailable: 6 },
      });
      expect(store.events.history(owner, 0, undefined, 100)).toEqual(proof);
      const continuation = store.events.append(
        owner,
        { seq: 6, ts: 1, type: 'actor_update', userId: 'gm', summary: 'Actor updated' },
        1,
      );
      expect(continuation.cursor).toBe(6);
    } finally {
      store.close();
    }
  });
});
