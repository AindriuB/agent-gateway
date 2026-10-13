// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CALL_TTL_MS,
  MAX_LIVE_CALLS,
  installChoiceWrapper,
  liveChoiceCalls,
  resetChoicesForTest,
  withChoiceCall,
  choiceFlag,
  choiceTombstones,
  MAX_TOMBSTONES,
  MAX_PACKS,
  MAX_FILTER_QUERIES,
  MAX_INDEX_ENTRIES,
} from '../../../src/adapters/pf2e/choices.js';
import { listChoices as rawListChoices, pf2eEmbedHook } from '../../../src/adapters/pf2e/embed.js';
import { HANDLERS } from '../../../src/tools/index.js';
import { setup, g } from '../../tools/gm-documents/fixtures.js';

const listChoices = (source: any, uuid: string, user: unknown = { id: 'u' }) =>
  rawListChoices(source, uuid, user);
const prompt = vi.fn();
const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

/** A stand-in for pf2e's ChoiceSetRuleElement: the original opens a prompt when nothing is selected. */
function makeClass() {
  const original = vi.fn(async function (this: any, args: any) {
    // pf2e returns before prompting for query choices and a failed predicate.
    if (this.choices?.query || this.failPredicate) return;
    const pre =
      this.selection === null ? undefined : OPTIONS.find((o) => o.value === this.selection);
    if (!pre) new g.PickAThingPrompt();
    else args.ruleSource.selection = pre.value;
  });
  class ChoiceSet {
    selection: unknown = null;
    allowedDrops: unknown = null;
    predicate: unknown = [];
    item = { isOfType: () => false, getRollOptions: () => ['x'] };
    constructor(
      public flag: string,
      public actor: any,
      public choices: any = OPTIONS,
    ) {}
    getRollOptions() {
      return ['y'];
    }
    resolveInjectedProperties(p: unknown) {
      return { test: () => !(this as any).failPredicate && !!p };
    }
    async inflateChoices() {
      return OPTIONS.map((o) => ({ ...o }));
    }
  }
  (ChoiceSet.prototype as any).preCreate = original;
  return { ChoiceSet, original };
}
let cls: ReturnType<typeof makeClass>;
const rules =
  (c: any, actorId = 'act') =>
  (flag: string, extra: object = {}) =>
    Object.assign(new c.ChoiceSet(flag, { id: actorId, getRollOptions: () => ['y'] }), extra);
const fire = (rule: any, callId: string | undefined, itemUuid = 'Compendium.p.c.Item.top') => {
  const args = {
    operation: callId ? { agentGateway: { callId } } : {},
    ruleSource: {} as any,
    itemSource: { name: 'I', _stats: { compendiumSource: itemUuid } },
    tempItems: [],
  };
  return Promise.resolve(rule.preCreate(args)).then(() => args);
};

beforeEach(() => {
  resetChoicesForTest();
  prompt.mockClear();
  g.PickAThingPrompt = prompt;
  cls = makeClass();
  g.game = { pf2e: { RuleElements: { builtin: { ChoiceSet: cls.ChoiceSet } } } };
});
afterEach(() => {
  delete g.PickAThingPrompt;
  delete g.game;
  resetChoicesForTest();
});

const call = (callId: string, decisions: any[], body: () => Promise<unknown>, actorId = 'act') =>
  withChoiceCall(callId, actorId, decisions, async () => body());

describe('wrapper install', () => {
  it('installs once, stores the pre-install method and survives a second install', () => {
    const before = (cls.ChoiceSet.prototype as any).preCreate;
    expect(installChoiceWrapper()).toBe(true);
    const wrapped = (cls.ChoiceSet.prototype as any).preCreate;
    expect(wrapped).not.toBe(before);
    expect(installChoiceWrapper()).toBe(true);
    expect((cls.ChoiceSet.prototype as any).preCreate).toBe(wrapped);
  });
  it('calls the stored original for a call outside any registered call, with unchanged args', async () => {
    installChoiceWrapper();
    const rule = rules(cls)('pick');
    const args: any = { operation: {}, ruleSource: {}, itemSource: {}, tempItems: [] };
    const snapshot = structuredClone(args);
    await rule.preCreate(args);
    expect(cls.original).toHaveBeenCalledTimes(1);
    expect(cls.original.mock.calls[0]![0]).toBe(args);
    expect(args).toEqual(snapshot);
  });
  it('wraps a swapped method as the new original', async () => {
    installChoiceWrapper();
    const swapped = vi.fn(async () => {});
    (cls.ChoiceSet.prototype as any).preCreate = swapped;
    expect(installChoiceWrapper()).toBe(true);
    await rules(cls)('pick').preCreate({ operation: {}, ruleSource: {} });
    expect(swapped).toHaveBeenCalledTimes(1);
    expect(cls.original).not.toHaveBeenCalled();
  });
  it('fails when the class or method is missing, and a call is then refused without a prompt', async () => {
    g.game = { pf2e: { RuleElements: { builtin: {} } } };
    expect(installChoiceWrapper()).toBe(false);
    const body = vi.fn();
    await expect(call('c1', [], body as any)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(body).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('answering inside a registered call', () => {
  beforeEach(() => {
    installChoiceWrapper();
  });
  const mk = () => rules(cls);
  it('answers a top-level choice without a prompt', async () => {
    const { report } = await call('c1', [{ flag: 'pick', value: 'b' }], async () => {
      const rule = mk()('pick');
      const args = await fire(rule, 'c1');
      expect(rule.selection).toBe('b');
      expect(args.ruleSource.ignored).toBeUndefined();
    });
    expect(report).toEqual([
      { flag: 'pick', itemUuid: 'Compendium.p.c.Item.top', status: 'answered' },
    ]);
    expect(prompt).not.toHaveBeenCalled();
    expect(liveChoiceCalls()).toBe(0);
  });
  it.each(['Compendium.p.c.Item.classfeature', 'Compendium.p.c.Item.granted'])(
    'answers a nested choice on %s by itemUuid',
    async (uuid) => {
      const { report } = await call(
        'c1',
        [{ flag: 'pick', itemUuid: uuid, value: 'a' }],
        async () => {
          await fire(mk()('pick'), 'c1', 'Compendium.p.c.Item.other');
          await fire(mk()('pick'), 'c1', uuid);
        },
      );
      expect(report.map((r) => r.status)).toEqual(['unanswered', 'answered']);
      expect(prompt).not.toHaveBeenCalled();
    },
  );
  it('ignores and reports an unknown flag', async () => {
    const { report } = await call('c1', [{ flag: 'other', value: 'a' }], async () => {
      const args = await fire(mk()('surprise'), 'c1');
      expect(args.ruleSource.ignored).toBe(true);
    });
    expect(report).toMatchObject([{ flag: 'surprise', status: 'unanswered' }]);
    expect(prompt).not.toHaveBeenCalled();
  });
  it('rejects a value that is not exactly an option', async () => {
    const { report } = await call('c1', [{ flag: 'pick', value: 'A' }], async () => {
      const args = await fire(mk()('pick'), 'c1');
      expect(args.ruleSource.ignored).toBe(true);
    });
    expect(report).toMatchObject([{ status: 'rejected' }]);
    expect(prompt).not.toHaveBeenCalled();
  });
  it.each([
    ['query', { choices: { query: 'x' } }],
    ['drop-in', { allowedDrops: { label: 'x' } }],
    ['predicate failure', { failPredicate: true }],
  ])('refuses the %s kind and reports it', async (_n, extra) => {
    const { report } = await call('c1', [{ flag: 'pick', value: 'a' }], async () => {
      await fire(mk()('pick', extra), 'c1');
    });
    expect(report).toMatchObject([{ status: 'unsupported' }]);
    expect(prompt).not.toHaveBeenCalled();
  });
  it('does not answer a forged callId or a call registered for another actor', async () => {
    await call('c1', [{ flag: 'pick', value: 'a' }], async () => {
      const forged = mk()('pick');
      await fire(forged, 'forged');
      expect(forged.selection).toBeNull();
      const other = rules(cls, 'someone-else')('pick');
      await fire(other, 'c1');
      expect(other.selection).toBeNull();
    });
    // Both went to the original, which is native behaviour (it would prompt).
    expect(cls.original).toHaveBeenCalledTimes(2);
  });
  it('keeps overlapping calls on the same actor apart', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = (id: string, value: string) =>
      call(id, [{ flag: 'pick', value }], async () => {
        await gate;
        const rule = mk()('pick');
        await fire(rule, id);
        return rule.selection;
      });
    const a = run('c1', 'a');
    const b = run('c2', 'b');
    expect(liveChoiceCalls()).toBe(2);
    release();
    expect((await a).value).toBe('a');
    expect((await b).value).toBe('b');
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('registry lifetime', () => {
  beforeEach(() => {
    installChoiceWrapper();
  });
  it('is empty after a throw', async () => {
    await expect(
      call('c1', [], async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(liveChoiceCalls()).toBe(0);
  });
  it('does not return on timeout; it waits for create, then the registry is empty', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => (finish = r));
    let settled = false;
    const run = withChoiceCall('c1', 'act', [], () => gate.then(() => 'made'), 10).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(settled).toBe(false);
    expect(liveChoiceCalls()).toBe(0);
    expect(choiceTombstones()).toBe(1);
    finish();
    await expect(run).resolves.toMatchObject({ value: 'made', timedOut: true });
    expect(choiceTombstones()).toBe(0);
    expect(CALL_TTL_MS).toBeGreaterThan(20);
  });
  it('refuses a ninth concurrent call before any write', async () => {
    const hold: Array<() => void> = [];
    const live = Array.from({ length: MAX_LIVE_CALLS }, (_, i) =>
      call(`c${i}`, [], () => new Promise<void>((r) => hold.push(r))),
    );
    expect(liveChoiceCalls()).toBe(MAX_LIVE_CALLS);
    const write = vi.fn();
    await expect(call('ninth', [], async () => write())).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    });
    expect(write).not.toHaveBeenCalled();
    hold.forEach((r) => r());
    await Promise.all(live);
    expect(liveChoiceCalls()).toBe(0);
  });
});

describe('flags', () => {
  it('follows pf2e default flag rules', () => {
    expect(choiceFlag({ flag: 'a b!c' }, 'x')).toBe('abc');
    expect(choiceFlag({}, 'Automaton Armament')).toBe('automatonArmament');
  });
});

describe('listing and preflight', () => {
  const docs = new Map<string, any>();
  const doc = (source: any) => ({ toObject: () => source, createEmbeddedDocuments: vi.fn() });
  const choiceRule = (extra: object = {}) => ({
    key: 'ChoiceSet',
    flag: 'pick',
    choices: [{ value: 'a', label: 'A' }],
    ...extra,
  });
  beforeEach(() => {
    docs.clear();
    g.fromUuid = vi.fn(async (u: string) => docs.get(u));
  });
  afterEach(() => {
    delete g.fromUuid;
  });
  it('lists nested choices within bounds, loading at most 32 documents and writing nothing', async () => {
    const writes = vi.fn();
    const many = Array.from({ length: 80 }, (_, i) => ({ value: `v${i}`, label: 'L'.repeat(300) }));
    docs.set('Compendium.p.c.Item.g', {
      toObject: () => ({ name: 'G', system: { rules: [choiceRule({ flag: 'inner' })] } }),
      write: writes,
    });
    const { choices: out } = await listChoices(
      {
        name: 'Top',
        type: 'class',
        system: {
          rules: [choiceRule({ choices: many })],
          items: { x: { uuid: 'Compendium.p.c.Item.g' } },
        },
      },
      'Compendium.p.c.Top',
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ flag: 'pick', itemUuid: 'Compendium.p.c.Top', truncated: true });
    expect(out[0]!.options).toHaveLength(50);
    expect(out[0]!.options[0]!.label.length).toBe(200);
    expect(out[1]).toMatchObject({
      flag: 'inner',
      itemUuid: 'Compendium.p.c.Item.g',
      truncated: false,
    });
    expect(g.fromUuid.mock.calls.length).toBeLessThanOrEqual(32);
    expect(writes).not.toHaveBeenCalled();
  });
  it('marks unsupported kinds and refuses more than 32 documents', async () => {
    const { choices: out } = await listChoices(
      { name: 'T', system: { rules: [choiceRule({ choices: { query: {} } })] } },
      'u',
    );
    expect(out[0]).toMatchObject({ unsupported: 'query choices', options: [] });
    const items = Object.fromEntries(
      Array.from({ length: 33 }, (_, i) => [`k${i}`, { uuid: `Compendium.p.c.Item.n${i}` }]),
    );
    await expect(
      listChoices({ name: 'K', system: { rules: [], items } }, 'u'),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGS',
    });
  });
  const prep = (source: any, extra: object = {}) =>
    pf2eEmbedHook.prepare({
      systemId: 'pf2e',
      actor: { feats: new Map() },
      entry: { uuid: 'Compendium.p.c.Top' },
      source,
      overrides: {},
      user: { id: 'u' },
      ...extra,
    });
  const feat = (rule: object) => ({ name: 'F', type: 'feat', system: { rules: [rule] } });
  it('rejects ambiguous, unmatched, unsupported and out-of-range decisions', async () => {
    installChoiceWrapper();
    docs.set('Compendium.p.c.Item.g', doc({ name: 'G', system: { rules: [choiceRule()] } }));
    const two = {
      name: 'T',
      type: 'class',
      system: { rules: [choiceRule()], items: { x: { uuid: 'Compendium.p.c.Item.g' } } },
    };
    await expect(prep(two, { choices: [{ flag: 'pick', value: 'a' }] })).rejects.toThrow(
      /several items/,
    );
    await expect(
      prep(two, {
        choices: [{ flag: 'pick', itemUuid: 'Compendium.p.c.Top', value: 'a' }],
        onUnanswered: 'ignore',
      }),
    ).resolves.toBeDefined();
    await expect(
      prep(feat(choiceRule()), { choices: [{ flag: 'zzz', value: 'a' }] }),
    ).rejects.toThrow(/matches no ChoiceSet/);
    await expect(
      prep(feat(choiceRule()), { choices: [{ flag: 'pick', value: 'q' }] }),
    ).rejects.toThrow(/not one of its options/);
    await expect(
      prep(feat(choiceRule({ choices: { query: {} } })), {
        choices: [{ flag: 'pick', value: 'q' }],
      }),
    ).rejects.toThrow(/cannot be answered \(query choices\)/);
  });
  it('rejects missing decisions by default, naming the flags, and accepts ignore', async () => {
    installChoiceWrapper();
    await expect(prep(feat(choiceRule()))).rejects.toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/"pick"/),
    });
    await expect(prep(feat(choiceRule()), { onUnanswered: 'ignore' })).resolves.toBeDefined();
    await expect(
      prep(feat(choiceRule()), { choices: [{ flag: 'pick', value: 'a' }] }),
    ).resolves.toBeDefined();
  });
  it('refuses a choice-needing import when the wrapper failed to install', async () => {
    await expect(
      prep(feat(choiceRule()), { choices: [{ flag: 'pick', value: 'a' }] }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/cannot be answered/) });
    expect(prompt).not.toHaveBeenCalled();
  });
});

describe('compendium_import handler', () => {
  let f: ReturnType<typeof setup>;
  beforeEach(() => {
    f = setup();
    g.game.system = { id: 'pf2e' };
    g.game.pf2e = { RuleElements: { builtin: { ChoiceSet: cls.ChoiceSet } } };
    installChoiceWrapper();
    g.Hooks = { on: vi.fn(() => 1), off: vi.fn() };
  });
  afterEach(() => {
    delete g.Hooks;
    f.restore();
  });
  it('rejects unanswered choices with INVALID_ARGS before intendCreate or any create', async () => {
    const { entry } = f.pack('Item');
    (entry as any).toObject = () => ({
      _id: 'source',
      name: 'Feat',
      type: 'feat',
      system: { rules: [{ key: 'ChoiceSet', flag: 'pick', choices: OPTIONS }] },
      flags: {},
    });
    const actor = f.doc('Actor', { name: 'A', type: 'character' });
    const ctx = f.ctx('compendium_import', { uuid: entry.uuid, actorUuid: actor.uuid });
    const out: any = await HANDLERS.compendium_import!(ctx);
    expect(out.error).toMatchObject({
      code: 'INVALID_ARGS',
      message: expect.stringMatching(/"pick"/),
    });
    expect(ctx.intendCreate).not.toHaveBeenCalled();
    expect(f.mutations.filter((m: any) => m.kind === 'createEmbedded')).toHaveLength(0);
    expect(prompt).not.toHaveBeenCalled();
  });
  it('records every document the late create makes through ctx.created, then reports incomplete', async () => {
    const { entry } = f.pack('Item');
    (entry as any).toObject = () => ({
      _id: 'source',
      name: 'Feat',
      type: 'feat',
      system: { rules: [{ key: 'ChoiceSet', flag: 'pick', choices: OPTIONS }] },
      flags: {},
    });
    const actor = f.doc('Actor', { _id: 'act', name: 'A', type: 'character' });
    let late: ((v: any) => void) | undefined;
    actor.createEmbeddedDocuments.mockImplementation(
      async (name: string, entries: any[], options: any) => {
        await new Promise<void>((r) => (late = r));
        // The ChoiceSet fires after the time limit: ignored, not prompted.
        await fire(rules(cls)('pick'), options.agentGateway.callId, entry.uuid);
        return entries.map((d) => f.doc(name, d, actor));
      },
    );
    const ctx = f.ctx('compendium_import', {
      uuid: entry.uuid,
      actorUuid: actor.uuid,
      choices: [{ flag: 'pick', value: 'a' }],
    });
    vi.useFakeTimers();
    try {
      const pending = Promise.resolve(HANDLERS.compendium_import!(ctx));
      await vi.advanceTimersByTimeAsync(CALL_TTL_MS + 1000);
      expect(ctx.created).not.toHaveBeenCalled();
      late!(undefined);
      const out: any = await pending;
      expect(out.error).toBeUndefined();
      expect(ctx.created).toHaveBeenCalledTimes(1);
      expect(out.structured.incomplete).toBe(true);
      expect(out.structured.choiceReport).toMatchObject([{ flag: 'pick', status: 'unanswered' }]);
      expect(out.text).toMatch(/past the time limit/);
    } finally {
      vi.useRealTimers();
    }
    expect(prompt).not.toHaveBeenCalled();
    expect(liveChoiceCalls()).toBe(0);
    expect(choiceTombstones()).toBe(0);
  });
  it('creates with an answer, passes the audit callId and returns a choiceReport', async () => {
    const { entry } = f.pack('Item');
    (entry as any).toObject = () => ({
      _id: 'source',
      name: 'Feat',
      type: 'feat',
      system: { rules: [{ key: 'ChoiceSet', flag: 'pick', choices: OPTIONS }] },
      flags: {},
    });
    const actor = f.doc('Actor', { _id: 'act', name: 'A', type: 'character' });
    actor.createEmbeddedDocuments.mockImplementation(
      async (name: string, entries: any[], options: any) => {
        const rule = rules(cls)('pick');
        await fire(rule, options.agentGateway.callId, entry.uuid);
        return entries.map((d) => f.doc(name, d, actor));
      },
    );
    const ctx = f.ctx('compendium_import', {
      uuid: entry.uuid,
      actorUuid: actor.uuid,
      choices: [{ flag: 'pick', value: 'a' }],
    });
    const out: any = await HANDLERS.compendium_import!(ctx);
    expect(out.error).toBeUndefined();
    expect(out.structured.choiceReport).toEqual([
      { flag: 'pick', itemUuid: entry.uuid, status: 'answered' },
    ]);
    expect(out.structured.incomplete).toBe(false);
    expect(ctx.created).toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
    expect(liveChoiceCalls()).toBe(0);
  });
});

describe('character_build listChoices handler', () => {
  let f: ReturnType<typeof setup>;
  beforeEach(() => {
    f = setup();
    g.game.system = { id: 'pf2e' };
  });
  afterEach(() => f.restore());
  const entryWith = (rules: unknown[]) => {
    const { entry, pack } = f.pack('Item');
    (entry as any).toObject = () => ({ name: 'Feat', type: 'feat', system: { rules } });
    f.docs.set(entry.uuid, entry);
    return { entry, pack };
  };
  const list = (uuid: string, who = f.gm) => {
    const ctx = f.ctx('character_build', { listChoices: uuid }, who);
    return Promise.resolve(HANDLERS.character_build!(ctx));
  };
  it('lists choices for the GM and writes nothing', async () => {
    const { entry } = entryWith([{ key: 'ChoiceSet', flag: 'pick', choices: OPTIONS }]);
    const out: any = await list(entry.uuid);
    expect(out.error).toBeUndefined();
    expect(out.structured.choices).toMatchObject([
      { flag: 'pick', itemUuid: entry.uuid, truncated: false },
    ]);
    expect(out.structured.choices[0].options).toHaveLength(2);
    expect(f.mutations).toHaveLength(0);
  });
  it('refuses a player and a hidden pack', async () => {
    const { entry, pack } = entryWith([]);
    expect((await list(entry.uuid, f.player as any)) as any).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    pack.testUserPermission.mockReturnValue(false);
    expect((await list(entry.uuid)) as any).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
  it('reports unsupported on another system', async () => {
    g.game.system = { id: 'starfinder' };
    const { entry } = entryWith([]);
    expect((await list(entry.uuid)) as any).toMatchObject({ structured: { supported: false } });
  });
});

describe('review fixes', () => {
  it('matches pf2e sluggify for default flags', () => {
    expect(choiceFlag({}, "Rogue's Racket")).toBe('roguesRacket');
    expect(choiceFlag({}, 'Armor-Master Of_Things')).toBe('armorMasterOfThings');
    expect(choiceFlag({}, 'x', 'some-slug')).toBe('someSlug');
    expect(choiceFlag({ slug: 'my-slug' }, 'x')).toBe('mySlug');
    // An item without a stored slug camel-cases the raw name, not sluggify(name).
    expect(choiceFlag({}, 'ABC Feat')).toBe('aBCFeat');
    expect(choiceFlag({}, 'ABC Feat', null)).toBe('aBCFeat');
  });

  describe('compendium filter and owned-item choices', () => {
    const uuids = Array.from({ length: 60 }, (_, i) => `Compendium.pf2e.eq.Item.f${i}`);
    let queried: Array<{ parent: unknown; choices: any }>;
    let packs: Map<string, any>;
    const pack = (id: string, size = 10, observable = true) => ({
      collection: id,
      metadata: { type: 'Item' },
      index: Object.assign([{ type: 'equipment' }, { type: 'feat' }], { size }),
      testUserPermission: vi.fn(() => observable),
    });
    beforeEach(() => {
      queried = [];
      class FakeActor {
        constructor(public data: unknown) {}
        getRollOptions() {
          return ['actor'];
        }
      }
      class FakeItem {
        constructor(
          public data: unknown,
          public opts: any,
        ) {}
        getRollOptions() {
          return ['item'];
        }
      }
      class FakeRule {
        item: any;
        constructor(
          public source: any,
          opts: any,
        ) {
          this.item = opts.parent;
        }
        async queryCompendium(choices: any) {
          queried.push({ parent: this.item.opts.parent, choices });
          return uuids.map((u, i) => ({ value: u, label: `F${i}` }));
        }
      }
      g.CONFIG = {
        Actor: { documentClass: FakeActor },
        Item: { documentClass: FakeItem },
        PF2E: { Item: { documentClasses: { equipment: {}, feat: {}, heritage: {} } } },
      };
      (FakeRule.prototype as any).preCreate = vi.fn();
      g.game.pf2e.RuleElements.builtin.ChoiceSet = FakeRule;
      packs = new Map([['pf2e.eq', pack('pf2e.eq')]]);
      g.game.packs = { values: () => packs.values(), get: (id: string) => packs.get(id) };
      g.game.items = { size: 0, get: () => undefined };
      installChoiceWrapper();
      g.fromUuid = vi.fn(async () => undefined);
    });
    afterEach(() => {
      delete g.CONFIG;
      delete g.fromUuid;
    });
    const filterRule = (extra: object = {}) => ({
      key: 'ChoiceSet',
      flag: 'pick',
      choices: { filter: ['x'], itemType: 'equipment', pack: 'pf2e.eq', ...extra },
    });
    const feat = (rule: object) => ({ name: 'F', type: 'feat', system: { rules: [rule] } });
    const prep = (source: any, extra: object = {}) =>
      pf2eEmbedHook.prepare({
        systemId: 'pf2e',
        actor: { feats: new Map(), getRollOptions: () => ['real'] },
        entry: { uuid: 'Compendium.p.c.Top' },
        source,
        overrides: {},
        user: { id: 'u' },
        ...extra,
      });
    it('lists a filter choice from index entries only (cut at 50, flagged truncated)', async () => {
      const { choices } = await listChoices(feat(filterRule()), 'Compendium.p.c.Top');
      expect(choices[0]).toMatchObject({ flag: 'pick', truncated: true });
      expect(choices[0]!.options).toHaveLength(50);
      expect(choices[0]).not.toHaveProperty('values');
      expect(choices[0]).not.toHaveProperty('dynamic');
      expect(g.fromUuid).not.toHaveBeenCalled();
    });
    it('accepts a UUID in the full set and rejects one outside it, against the real actor', async () => {
      const actor = { feats: new Map(), getRollOptions: () => ['real'] };
      await expect(
        prep(feat(filterRule()), { actor, choices: [{ flag: 'pick', value: uuids[59] }] }),
      ).resolves.toBeDefined();
      expect(queried[0]!.parent).toBe(actor);
      await expect(
        prep(feat(filterRule()), {
          actor,
          choices: [{ flag: 'pick', value: 'Compendium.p.c.Item.zzz' }],
        }),
      ).rejects.toThrow(/not one of its options/);
    });
    it('leaves actor-dependent filters dynamic when listing, without querying', async () => {
      for (const rule of [
        filterRule({ itemType: undefined }), // default itemType is feat
        filterRule({ itemType: 'heritage' }),
        filterRule({ filter: ['{actor|x}'] }),
      ]) {
        const { choices } = await listChoices(feat(rule), 'u');
        expect(choices[0]).toMatchObject({ dynamic: true, options: [] });
      }
      expect(queried).toHaveLength(0);
    });
    it('normalises an unknown itemType to feat before counting and dynamic checks', async () => {
      // An invalid itemType would otherwise count zero packs and let pf2e index every feat pack.
      const bogus = filterRule({ itemType: 'bogus', pack: undefined });
      expect((await listChoices(feat(bogus), 'u')).choices[0]).toMatchObject({ dynamic: true });
      packs = new Map(
        Array.from({ length: MAX_PACKS + 1 }, (_, i) => [`p${i}`, pack(`p${i}`)] as const),
      );
      const actor = { feats: new Map(), getRollOptions: () => [] };
      const out = await prep(feat(bogus), {
        actor,
        choices: [{ flag: 'pick', value: 'whatever' }],
      });
      expect(out).toBeDefined(); // dynamic: accepted, enforced at create time
      expect(queried).toHaveLength(0);
    });
    it('leaves actor-dependent filters dynamic on import too', async () => {
      const actor = { feats: new Map(), getRollOptions: () => [] };
      for (const filter of [['{actor|x}'], ['self:class:rogue']]) {
        await expect(
          prep(feat(filterRule({ filter })), {
            actor,
            choices: [{ flag: 'pick', value: 'anything' }],
          }),
        ).resolves.toBeDefined();
      }
      expect(queried).toHaveLength(0);
    });
    it('fails closed without a user', async () => {
      expect((await rawListChoices(feat(filterRule()), 'u', undefined)).choices[0]).toMatchObject({
        dynamic: true,
      });
      g.fromUuid = vi.fn(async () => ({ toObject: () => ({ name: 'G', system: { rules: [] } }) }));
      await expect(
        pf2eEmbedHook.prepare({
          systemId: 'pf2e',
          actor: { feats: new Map() },
          entry: { uuid: 'x' },
          source: {
            name: 'C',
            type: 'class',
            system: { rules: [], items: { a: { uuid: 'Compendium.p.c.Item.g' } } },
          },
          overrides: {},
        }),
      ).rejects.toThrow(/not available/);
    });
    it('leaves a filter dynamic, before any query, when it would scan too much', async () => {
      packs = new Map(
        Array.from({ length: MAX_PACKS + 1 }, (_, i) => [`p${i}`, pack(`p${i}`)] as const),
      );
      const unnamed = filterRule({ pack: undefined });
      expect((await listChoices(feat(unnamed), 'u')).choices[0]).toMatchObject({ dynamic: true });
      packs = new Map([['pf2e.eq', pack('pf2e.eq', MAX_INDEX_ENTRIES + 1)]]);
      expect((await listChoices(feat(filterRule()), 'u')).choices[0]).toMatchObject({
        dynamic: true,
      });
      expect(queried).toHaveLength(0);
    });
    it('shares the query budget across a whole scan', async () => {
      const rules = Array.from(
        { length: MAX_FILTER_QUERIES + 1 },
        (_, i) => filterRule({}) && { ...filterRule(), flag: `f${i}` },
      );
      const { choices } = await listChoices({ name: 'T', system: { rules } }, 'u');
      expect(queried).toHaveLength(MAX_FILTER_QUERIES);
      expect(choices.filter((c) => c.dynamic)).toHaveLength(1);
    });
    it('drops options the user cannot observe and refuses an unobservable named pack', async () => {
      const user = { id: 'u' };
      packs = new Map([['pf2e.eq', pack('pf2e.eq', 10, false)]]);
      expect((await listChoices(feat(filterRule()), 'u', user)).choices[0]).toMatchObject({
        dynamic: true,
      });
      packs = new Map([
        ['pf2e.eq', pack('pf2e.eq')],
        ['pf2e.hid', pack('pf2e.hid', 10, false)],
      ]);
      const hidden = await listChoices(
        feat(filterRule({ pack: undefined, itemType: 'equipment' })),
        'u',
        user,
      );
      expect(hidden.choices[0]!.options.length).toBeLessThanOrEqual(50);
      const mixed = [
        { value: 'Compendium.pf2e.hid.Item.a', label: 'hidden' },
        { value: 'Compendium.pf2e.eq.Item.b', label: 'shown' },
      ];
      (g.game.pf2e.RuleElements.builtin.ChoiceSet.prototype as any).queryCompendium = async () =>
        mixed;
      const out = await listChoices(
        feat(filterRule({ pack: undefined, itemType: 'equipment' })),
        'u',
        user,
      );
      expect(out.choices[0]!.options).toEqual([
        { value: 'Compendium.pf2e.eq.Item.b', label: 'shown' },
      ]);
    });
    it('treats owned-item choices with types as dynamic, and without types as unsupported', async () => {
      const owned = {
        key: 'ChoiceSet',
        flag: 'pick',
        choices: { ownedItems: true, types: ['weapon'] },
      };
      const { choices } = await listChoices(feat(owned), 'u');
      expect(choices[0]).toMatchObject({ dynamic: true, options: [] });
      await expect(
        prep(feat(owned), { choices: [{ flag: 'pick', value: 'anything' }] }),
      ).resolves.toBeDefined();
      const bare = { key: 'ChoiceSet', flag: 'pick', choices: { ownedItems: true } };
      const out = await listChoices(feat(bare), 'u');
      expect(out.choices[0]).toMatchObject({ unsupported: expect.stringMatching(/without types/) });
    });
  });

  describe('GrantItem placeholders', () => {
    beforeEach(() => {
      installChoiceWrapper();
      g.fromUuid = vi.fn(async (u: string) =>
        u === 'Compendium.p.c.Item.granted'
          ? {
              toObject: () => ({
                name: 'G',
                system: { rules: [{ key: 'ChoiceSet', flag: 'inner', choices: OPTIONS }] },
              }),
            }
          : undefined,
      );
    });
    afterEach(() => {
      delete g.fromUuid;
    });
    const src = {
      name: 'F',
      type: 'feat',
      system: {
        rules: [
          {
            key: 'ChoiceSet',
            flag: 'pick',
            choices: [{ value: 'Compendium.p.c.Item.granted', label: 'G' }],
          },
          { key: 'GrantItem', uuid: '{item|flags.pf2e.rulesSelections.pick}' },
        ],
      },
    };
    const prep = (extra: object) =>
      pf2eEmbedHook.prepare({
        systemId: 'pf2e',
        actor: { feats: new Map() },
        entry: { uuid: 'Compendium.p.c.Top' },
        source: structuredClone(src),
        overrides: {},
        user: { id: 'u' },
        ...extra,
      });
    it('resolves the grant from the decision and then needs the granted choice answered', async () => {
      const decisions = [{ flag: 'pick', value: 'Compendium.p.c.Item.granted' }];
      await expect(prep({ choices: decisions })).rejects.toThrow(/"inner"/);
      await expect(
        prep({ choices: [...decisions, { flag: 'inner', value: 'a' }] }),
      ).resolves.toBeDefined();
      expect(g.fromUuid).toHaveBeenCalledWith('Compendium.p.c.Item.granted');
    });
    it.each(['pf2e', 'system'])('resolves the flags.%s form of the placeholder', async (ns) => {
      const aliased = structuredClone(src);
      (aliased.system.rules[1] as any).uuid = `{item|flags.${ns}.rulesSelections.pick}`;
      const decisions = [
        { flag: 'pick', value: 'Compendium.p.c.Item.granted' },
        { flag: 'inner', value: 'a' },
      ];
      await expect(
        pf2eEmbedHook.prepare({
          systemId: 'pf2e',
          actor: { feats: new Map() },
          entry: { uuid: 'Compendium.p.c.Top' },
          source: aliased,
          overrides: {},
          user: { id: 'u' },
          choices: decisions,
        }),
      ).resolves.toBeDefined();
      expect(g.fromUuid).toHaveBeenCalledWith('Compendium.p.c.Item.granted');
      const listed = await listChoices(aliased, 'Compendium.p.c.Top');
      expect(listed.message).toMatch(/1 grant/);
    });
    it('still refuses an unknown namespace', async () => {
      const bad = structuredClone(src);
      (bad.system.rules[1] as any).uuid = '{item|flags.other.rulesSelections.pick}';
      await expect(
        pf2eEmbedHook.prepare({
          systemId: 'pf2e',
          actor: { feats: new Map() },
          entry: { uuid: 'x' },
          source: bad,
          overrides: {},
          user: { id: 'u' },
          choices: [{ flag: 'pick', value: 'Compendium.p.c.Item.granted' }],
        }),
      ).rejects.toThrow(/cannot be resolved headless/);
    });
    it('never loads a decided uuid that the choice does not offer', async () => {
      await expect(prep({ choices: [{ flag: 'pick', value: 'Actor.x.Item.y' }] })).rejects.toThrow(
        /not one of its options|cannot be resolved/,
      );
      await expect(
        prep({ choices: [{ flag: 'pick', value: 'Item.secret' }], onUnanswered: 'ignore' }),
      ).rejects.toThrow();
      expect(g.fromUuid).not.toHaveBeenCalledWith('Actor.x.Item.y');
      expect(g.fromUuid).not.toHaveBeenCalledWith('Item.secret');
    });
    it('refuses an unobservable granted item without naming it', async () => {
      g.fromUuid = vi.fn(async () => ({
        toObject: () => ({ name: 'TopSecretName', system: { rules: [] } }),
        testUserPermission: () => false,
      }));
      await expect(
        pf2eEmbedHook.prepare({
          systemId: 'pf2e',
          actor: { feats: new Map() },
          entry: { uuid: 'Compendium.p.c.Top' },
          source: {
            name: 'F',
            type: 'class',
            system: { rules: [], items: { a: { uuid: 'Compendium.p.c.Item.s' } } },
          },
          overrides: {},
          user: { id: 'u' },
        }),
      ).rejects.toSatisfy(
        (e: Error) => !/TopSecretName/.test(e.message) && /not available/.test(e.message),
      );
    });
    it('is skipped (with a note) when listing, refused when importing without a decision', async () => {
      const out = await listChoices(structuredClone(src), 'Compendium.p.c.Top');
      expect(out.choices.map((c) => c.flag)).toEqual(['pick']);
      expect(out.message).toMatch(/1 grant/);
      await expect(prep({ onUnanswered: 'ignore' })).rejects.toThrow(/cannot be resolved headless/);
    });
  });

  describe('wrapper marker', () => {
    it('uses registry-wide symbols so other copies of the module agree', () => {
      installChoiceWrapper();
      const wrapped = (cls.ChoiceSet.prototype as any).preCreate;
      expect(wrapped[Symbol.for('agent-gateway.pf2e.choiceSetWrapper')]).toBe(true);
      expect(Symbol.for('agent-gateway.pf2e.choiceHandled')).toBe(
        Symbol.for('agent-gateway.pf2e.choiceHandled'),
      );
    });
    it('does not rewrap its own marked method, and survives a module wrapping on top', async () => {
      installChoiceWrapper();
      const ours = (cls.ChoiceSet.prototype as any).preCreate;
      installChoiceWrapper();
      expect((cls.ChoiceSet.prototype as any).preCreate).toBe(ours);
      // A copy of this wrapper from an older load keeps its marker: left alone.
      const marked: any = vi.fn();
      marked[Symbol.for('agent-gateway.pf2e.choiceSetWrapper')] = true;
      (cls.ChoiceSet.prototype as any).preCreate = marked;
      installChoiceWrapper();
      expect((cls.ChoiceSet.prototype as any).preCreate).toBe(marked);
      // Another module wraps on top of ours: a reinstall terminates and the chain still answers.
      (cls.ChoiceSet.prototype as any).preCreate = ours;
      const outer = vi.fn(function (this: any, a: any) {
        return ours.call(this, a);
      });
      (cls.ChoiceSet.prototype as any).preCreate = outer;
      expect(installChoiceWrapper()).toBe(true);
      const rule = rules(cls)('pick');
      await call('c1', [{ flag: 'pick', value: 'b' }], async () => {
        await fire(rule, 'c1');
      });
      expect(rule.selection).toBe('b');
      expect(prompt).not.toHaveBeenCalled();
    });
  });

  describe('timed-out calls', () => {
    beforeEach(() => {
      installChoiceWrapper();
    });
    it('keeps a bounded tombstone so a late ChoiceSet never prompts, reports it, then clears it', async () => {
      let finish!: () => void;
      const gate = new Promise<void>((r) => (finish = r));
      const run = withChoiceCall('c1', 'act', [{ flag: 'pick', value: 'a' }], () => gate, 10);
      await new Promise((r) => setTimeout(r, 40));
      expect(liveChoiceCalls()).toBe(0);
      expect(choiceTombstones()).toBe(1);
      const late = rules(cls)('pick');
      const args = await fire(late, 'c1');
      expect(args.ruleSource.ignored).toBe(true);
      expect(late.selection).toBeNull();
      expect(cls.original).not.toHaveBeenCalled();
      expect(prompt).not.toHaveBeenCalled();
      // Another actor's native ChoiceSet with the same id is not swallowed.
      await fire(rules(cls, 'other')('pick'), 'c1');
      expect(cls.original).toHaveBeenCalledTimes(1);
      finish();
      const done = await run;
      expect(done.timedOut).toBe(true);
      expect(done.report).toMatchObject([{ flag: 'pick', status: 'unanswered' }]);
      expect(choiceTombstones()).toBe(0);
    });
    it('cleans up the tombstone when create rejects after the timeout', async () => {
      let fail!: (e: Error) => void;
      const gate = new Promise<void>((_, r) => (fail = r));
      const run = withChoiceCall('c1', 'act', [], () => gate, 5);
      await new Promise((r) => setTimeout(r, 30));
      expect(choiceTombstones()).toBe(1);
      fail(new Error('native failure'));
      await expect(run).rejects.toThrow('native failure');
      expect(choiceTombstones()).toBe(0);
      expect(liveChoiceCalls()).toBe(0);
    });
    it('refuses new calls once the tombstone bound is reached', async () => {
      const gates: Array<() => void> = [];
      const runs: Array<Promise<unknown>> = [];
      // Eight at a time: that is the live-call limit; each becomes a tombstone after 1 ms.
      for (let batch = 0; batch < MAX_TOMBSTONES / MAX_LIVE_CALLS; batch++) {
        for (let i = 0; i < MAX_LIVE_CALLS; i++)
          runs.push(
            withChoiceCall(
              `t${batch}-${i}`,
              'act',
              [],
              () => new Promise<void>((r) => gates.push(r)),
              1,
            ),
          );
        await new Promise((r) => setTimeout(r, 15));
      }
      expect(choiceTombstones()).toBe(MAX_TOMBSTONES);
      const write = vi.fn();
      await expect(call('next', [], async () => write())).rejects.toMatchObject({
        code: 'INVALID_ARGS',
      });
      expect(write).not.toHaveBeenCalled();
      gates.forEach((r) => r());
      await Promise.all(runs);
      expect(choiceTombstones()).toBe(0);
    });
  });
});
