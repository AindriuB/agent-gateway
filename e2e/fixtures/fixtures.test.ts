import { describe, expect, it } from 'vitest';
import { loadLimits, validateLimits } from '../../module/src/ratelimit/config.js';
import { HIDDEN_STRINGS, leakMatchers } from './manifest.js';
import { FIXTURE_RUNTIME } from './runtime.js';
import {
  buildSeedPlan,
  expectedFlaggedCounts,
  FIXTURE_FLAG_KEY,
  FIXTURE_FLAG_SCOPE,
  PLAYER_AGENTS_SETTING,
  E2E_RATE_LIMITS,
  RATE_LIMITS_SETTING,
  FIXTURE_PREFIX,
  OWN_ACTOR_ID,
  type SeedStep,
} from './spec.js';
import { verifyFixtureResult, type FixtureResult } from './verify.js';

const RATE_KEY = 'agent-gateway.rateLimits';
const PRODUCT_DEFAULT =
  '{"playerAgents":{"read":60,"write":10},"gmAgents":{"read":60,"write":10},"agents":{}}';

const plan = buildSeedPlan({ gmUser: 'dev-gm', playerUser: 'player1' });
const named = (t: SeedStep['type']) => plan.filter((s) => s.type === t);

describe('fixture spec', () => {
  it('flags every document and prefixes every named one', () => {
    for (const s of plan) {
      const f = (s.data.flags as Record<string, Record<string, unknown>>)[FIXTURE_FLAG_SCOPE];
      expect(f?.[FIXTURE_FLAG_KEY], JSON.stringify(s.data)).toBe(true);
    }
    for (const s of plan.filter((p) => p.type === 'Folder' || p.type === 'JournalEntry')) {
      expect(String(s.data.name).startsWith(FIXTURE_PREFIX)).toBe(true);
    }
  });

  it('matches the documented set', () => {
    expect(expectedFlaggedCounts()).toEqual({
      Folder: 1,
      JournalEntry: 3,
      ChatMessage: 6,
      Token: 2,
      Drawing: 1,
      Note: 2,
      Wall: 1,
    });
    const journals = named('JournalEntry');
    expect(
      journals.map((j) => [j.data.name, (j.data.ownership as { default: number }).default]),
    ).toEqual([
      ['ag-test-hidden', 0],
      ['ag-test-public', 2],
      ['ag-test-limited', 1],
    ]);
    expect(journals[0]?.data.folder).toEqual({ $ref: 'hiddenFolder' });
    const pub = journals[1]?.data.pages as Array<{
      name: string;
      ownership?: { default: number };
      text: Record<string, unknown>;
    }>;
    expect(pub.map((p) => p.name)).toEqual(['public', 'gm', 'markdown']);
    expect(pub[0]?.text.content).toContain('<section class="secret">');
    expect(pub[1]?.ownership).toEqual({ default: 0 });
    expect(pub[2]?.text.format).toBe(2);
    expect(String(pub[2]?.text.markdown)).toContain('secret');
    // The HTML is seeded too, so the page does not depend on the API rendering markdown.
    expect(String(pub[2]?.text.content)).toContain('<section class="secret">');
    expect(String(pub[2]?.text.content)).toContain('MARKDOWN-PAGE visible');
  });

  it('creates the chat messages the read flows depend on', () => {
    const chat = named('ChatMessage');
    expect(chat.some((c) => c.roll === '7d6' && c.data.blind === true)).toBe(true);
    expect(chat.filter((c) => c.data.whisper).length).toBe(3);
    expect(
      chat.some((c) => (c.data.speaker as { actor?: string } | undefined)?.actor === OWN_ACTOR_ID),
    ).toBe(true);
  });

  it('puts every embedded placeable on the scene', () => {
    for (const t of ['Token', 'Drawing', 'Note', 'Wall'] as const) {
      expect(named(t).every((s) => s.parent === 'scene')).toBe(true);
    }
    expect(named('Token').map((s) => s.data.hidden)).toEqual([true, false]);
    expect(named('Wall')[0]?.data.door).toBe(2);
  });

  it('lists the hidden strings, including the formula, and matches the blind total only when labelled', () => {
    expect(HIDDEN_STRINGS).not.toContain('7d6');
    expect(HIDDEN_STRINGS).toContain('ag-test-hidden');
    expect(leakMatchers({ total: 12, messageId: 'abc' })).toHaveLength(leakMatchers().length + 5);
  });
});

// A small in-memory Foundry, enough for the runtime's seed and clean.
function fakeWorld(
  opts: { activeScene?: boolean; settingRegistered?: boolean; rateLimitsRegistered?: boolean } = {},
) {
  let n = 0;
  const mk = (data: Record<string, unknown>) => {
    const id = `id${++n}`;
    return {
      ...data,
      id,
      uuid: `uuid.${id}`,
      getFlag: (s: string, k: string) =>
        (data.flags as Record<string, Record<string, unknown>> | undefined)?.[s]?.[k],
    };
  };
  type Doc = ReturnType<typeof mk> & { name?: unknown };
  const col = (): { contents: Doc[] } => ({ contents: [] });
  const world = { folders: col(), journal: col(), messages: col() } as Record<
    string,
    { contents: Doc[] }
  >;
  const sceneCols = { tokens: col(), drawings: col(), notes: col(), walls: col() } as Record<
    string,
    { contents: Doc[] }
  >;
  const plural: Record<string, string> = {
    Token: 'tokens',
    Drawing: 'drawings',
    Note: 'notes',
    Wall: 'walls',
  };
  const scene = {
    ...sceneCols,
    uuid: 'Scene.s1',
    createEmbeddedDocuments: async (t: string, items: Record<string, unknown>[]) =>
      items.map((d) => {
        const doc = mk(d);
        sceneCols[plural[t] as string]?.contents.push(doc);
        return doc;
      }),
    deleteEmbeddedDocuments: async (t: string, ids: string[]) => {
      const c = sceneCols[plural[t] as string] as { contents: Doc[] };
      c.contents = c.contents.filter((d) => !ids.includes(d.id));
    },
  };
  const target: Record<string, string> = {
    Folder: 'folders',
    JournalEntry: 'journal',
    ChatMessage: 'messages',
  };
  const getDocumentClass = (t: string) => ({
    create: async (d: Record<string, unknown>) => {
      const doc = mk(d);
      (world[target[t] as string] as { contents: Doc[] }).contents.push(doc);
      return doc;
    },
    deleteDocuments: async (ids: string[]) => {
      const c = world[target[t] as string] as { contents: Doc[] };
      c.contents = c.contents.filter((d) => !ids.includes(d.id));
    },
  });
  // A second scene holding a stale flagged token and a real one.
  const otherCols = { tokens: col(), drawings: col(), notes: col(), walls: col() } as Record<
    string,
    { contents: Doc[] }
  >;
  const other = {
    ...otherCols,
    uuid: 'Scene.s2',
    createEmbeddedDocuments: async () => [],
    deleteEmbeddedDocuments: async (t: string, ids: string[]) => {
      const c = otherCols[plural[t] as string] as { contents: Doc[] };
      c.contents = c.contents.filter((d) => !ids.includes(d.id));
    },
  };
  otherCols.tokens?.contents.push(
    mk({ name: 'ag-test-stale', flags: { 'agent-gateway': { fixture: true } } }),
    mk({ name: 'Other Real Token' }),
  );
  // Pre-existing, unflagged content that must survive.
  world.journal?.contents.push(mk({ name: 'Real Journal' }));
  world.messages?.contents.push(mk({ content: 'real chat' }));
  sceneCols.tokens?.contents.push(mk({ name: 'Real Token' }));
  const registered = new Set<string>(
    opts.settingRegistered === false
      ? []
      : [
          'agent-gateway.playerAgentsEnabled',
          ...(opts.rateLimitsRegistered === false ? [] : ['agent-gateway.rateLimits']),
        ],
  );
  const users = [
    { id: 'gm1', name: 'dev-gm', isGM: true },
    { id: 'p1', name: 'player1', isGM: false },
  ];
  const settings = new Map<string, unknown>();
  const game = {
    user: { isGM: true },
    settings: {
      get: (ns: string, key: string) => {
        const k = `${ns}.${key}`;
        if (!settings.has(k) && !registered.has(k)) throw new Error(`not registered: ${k}`);
        if (settings.has(k)) return settings.get(k);
        return k === RATE_KEY ? PRODUCT_DEFAULT : false;
      },
      set: async (ns: string, key: string, v: unknown) => void settings.set(`${ns}.${key}`, v),
    },
    scenes: { active: opts.activeScene === false ? null : scene, contents: [scene, other] },
    folders: world.folders,
    journal: world.journal,
    messages: world.messages,
    users: { contents: users, getName: (nm: string) => users.find((u) => u.name === nm) },
  };
  class Roll {
    total = 21;
    constructor(public formula: string) {}
    async evaluate() {
      return this;
    }
    toJSON() {
      return { formula: this.formula, total: this.total };
    }
  }
  return { game, getDocumentClass, Roll, world, scene, settings };
}

async function run(
  w: ReturnType<typeof fakeWorld>,
  mode: 'seed' | 'clean',
  restorePlayerAgents?: boolean,
  restoreRateLimits?: string,
): Promise<FixtureResult> {
  const fn = new Function('game', 'getDocumentClass', 'Roll', `return (${FIXTURE_RUNTIME});`)(
    w.game,
    w.getDocumentClass,
    w.Roll,
  ) as (a: unknown) => Promise<FixtureResult>;
  return fn({
    mode,
    plan,
    flagScope: FIXTURE_FLAG_SCOPE,
    flagKey: FIXTURE_FLAG_KEY,
    policySetting: PLAYER_AGENTS_SETTING,
    restorePlayerAgents,
    rateLimitSetting: RATE_LIMITS_SETTING,
    e2eRateLimits: E2E_RATE_LIMITS,
    restoreRateLimits,
  });
}

describe('fixture runtime', () => {
  it('seeds the full set, leaves unflagged documents alone, and passes verification', async () => {
    const w = fakeWorld();
    const r = await run(w, 'seed');
    expect(verifyFixtureResult('seed', r)).toEqual([]);
    expect(r.totals.blindRollTotal).toBe(21);
    expect(r.uuids.activeScene).toBe('Scene.s1');
    expect(r.uuids.hidden).toBeTruthy();
    expect(r.after.JournalEntry).toEqual({ flagged: 3, unflagged: 1 });
  });

  it('seeding twice leaves exactly one of each', async () => {
    const w = fakeWorld();
    const first = await run(w, 'seed');
    const second = await run(w, 'seed');
    expect(second.after).toEqual(first.after);
    expect(second.before.ChatMessage?.flagged).toBe(6);
    expect(verifyFixtureResult('seed', second)).toEqual([]);
  });

  it('clean removes only flagged documents', async () => {
    const w = fakeWorld();
    await run(w, 'seed');
    const r = await run(w, 'clean');
    expect(verifyFixtureResult('clean', r)).toEqual([]);
    expect(r.before.Token).toEqual({ flagged: 2, unflagged: 2 });
    expect(r.after.Token).toEqual({ flagged: 0, unflagged: 2 });
    expect(w.world.journal?.contents.map((d) => d.name)).toEqual(['Real Journal']);
  });

  it('clean and re-seed also sweep flagged documents on other scenes', async () => {
    const w = fakeWorld();
    const r = await run(w, 'seed');
    expect(r.before.Token).toEqual({ flagged: 1, unflagged: 2 });
    expect(r.after.Token).toEqual({ flagged: 2, unflagged: 2 });
    const c = await run(w, 'clean');
    expect(c.after.Token).toEqual({ flagged: 0, unflagged: 2 });
  });

  it('seed fails clearly without an active scene; clean still works', async () => {
    const w = fakeWorld({ activeScene: false });
    await expect(run(w, 'seed')).rejects.toThrow(/no active scene/);
    await expect(run(w, 'clean')).resolves.toBeTruthy();
  });

  it('refuses to run as a non-GM', async () => {
    const w = fakeWorld();
    w.game.user.isGM = false;
    await expect(run(w, 'seed')).rejects.toThrow(/GM/);
  });
});

describe('fixture runtime: player agents setting', () => {
  const KEY = 'agent-gateway.playerAgentsEnabled';

  it('seed turns player agents on and reports the previous value', async () => {
    const w = fakeWorld();
    const r = await run(w, 'seed');
    expect(r.policy).toEqual({ before: false, after: true });
    expect(w.settings.get(KEY)).toBe(true);
    expect(verifyFixtureResult('seed', r)).toEqual([]);
  });

  it('clean restores the recorded previous value, either way', async () => {
    for (const previous of [false, true]) {
      const w = fakeWorld();
      await run(w, 'seed');
      const r = await run(w, 'clean', previous);
      expect(w.settings.get(KEY)).toBe(previous);
      expect(verifyFixtureResult('clean', r, previous)).toEqual([]);
    }
  });

  it('clean with nothing recorded leaves the setting alone', async () => {
    const w = fakeWorld();
    w.settings.set(KEY, true);
    const r = await run(w, 'clean');
    expect(w.settings.get(KEY)).toBe(true);
    expect(r.policy).toEqual({});
  });

  it('a seed that finds the setting on reports true, so a clean can put it back on', async () => {
    const w = fakeWorld();
    w.settings.set(KEY, true);
    expect((await run(w, 'seed')).policy).toEqual({ before: true, after: true });
  });

  it('seed fails clearly when the module setting is not registered', async () => {
    const w = fakeWorld({ settingRegistered: false });
    await expect(run(w, 'seed')).rejects.toThrow(/not registered: rebuild/);
  });

  it('verification catches a seed that left it off and a clean that did not restore', async () => {
    const w = fakeWorld();
    const seeded = await run(w, 'seed');
    expect(
      verifyFixtureResult('seed', { ...seeded, policy: { before: false, after: false } }),
    ).toContain('the seed did not leave playerAgentsEnabled on');
    const cleaned = await run(w, 'clean', false);
    expect(verifyFixtureResult('clean', { ...cleaned, policy: { after: true } }, false)).toContain(
      'clean did not restore playerAgentsEnabled to false',
    );
  });
});

describe('fixture runtime: rate limits setting', () => {
  it('seed raises the limits above the product default and reports the previous value', async () => {
    const w = fakeWorld();
    const r = await run(w, 'seed');
    expect(r.rateLimits).toEqual({ before: PRODUCT_DEFAULT, after: E2E_RATE_LIMITS });
    expect(w.settings.get(RATE_KEY)).toBe(E2E_RATE_LIMITS);
    expect(verifyFixtureResult('seed', r)).toEqual([]);
  });

  it('the seeded limits are well above the product default of 60 reads and 10 writes', () => {
    const p = JSON.parse(E2E_RATE_LIMITS);
    for (const cls of ['playerAgents', 'gmAgents']) {
      expect(p[cls].read).toBeGreaterThanOrEqual(600);
      expect(p[cls].write).toBeGreaterThanOrEqual(100);
      expect(p[cls].read).toBeLessThanOrEqual(10000);
    }
  });

  it('the module accepts the seeded limits as written (they do not fall to the strict limit)', () => {
    expect(() => validateLimits(JSON.parse(E2E_RATE_LIMITS))).not.toThrow();
    const l = loadLimits(E2E_RATE_LIMITS);
    expect(l.classes.playerAgents.read).toBe(JSON.parse(E2E_RATE_LIMITS).playerAgents.read);
  });

  it('clean restores the recorded previous value, including a customised one', async () => {
    for (const previous of [PRODUCT_DEFAULT, '{"custom":true}']) {
      const w = fakeWorld();
      await run(w, 'seed');
      const r = await run(w, 'clean', undefined, previous);
      expect(w.settings.get(RATE_KEY)).toBe(previous);
      expect(verifyFixtureResult('clean', r, undefined, previous)).toEqual([]);
    }
  });

  it('clean with nothing recorded leaves the setting alone', async () => {
    const w = fakeWorld();
    w.settings.set(RATE_KEY, '{"mine":1}');
    const r = await run(w, 'clean');
    expect(w.settings.get(RATE_KEY)).toBe('{"mine":1}');
    expect(r.rateLimits).toEqual({});
  });

  it('seed fails clearly when the setting is not registered', async () => {
    const w = fakeWorld({ rateLimitsRegistered: false });
    await expect(run(w, 'seed')).rejects.toThrow(/rateLimits is not registered: rebuild/);
  });

  it('verification catches a seed that left the product limits and a clean that did not restore', async () => {
    const w = fakeWorld();
    const seeded = await run(w, 'seed');
    expect(
      verifyFixtureResult('seed', {
        ...seeded,
        rateLimits: { before: 'x', after: PRODUCT_DEFAULT },
      }),
    ).toContain('the seed did not leave the e2e rate limits in place');
    const cleaned = await run(w, 'clean', undefined, PRODUCT_DEFAULT);
    expect(
      verifyFixtureResult(
        'clean',
        { ...cleaned, rateLimits: { after: E2E_RATE_LIMITS } },
        undefined,
        PRODUCT_DEFAULT,
      ),
    ).toContain('clean did not restore the rateLimits setting');
  });
});

describe('verifyFixtureResult', () => {
  it('flags changed unflagged counts and leftovers', () => {
    const r: FixtureResult = {
      before: { Token: { flagged: 2, unflagged: 1 } },
      after: { Token: { flagged: 1, unflagged: 0 } },
      totals: {},
      uuids: {},
    };
    expect(verifyFixtureResult('clean', r).join('\n')).toMatch(/unflagged documents changed/);
    expect(verifyFixtureResult('clean', r).join('\n')).toMatch(/1 flagged documents after clean/);
  });
});
