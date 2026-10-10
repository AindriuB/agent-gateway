import { describe, expect, it } from 'vitest';
import { HIDDEN_STRINGS, leakMatchers } from './manifest.js';
import { FIXTURE_RUNTIME } from './runtime.js';
import {
  buildSeedPlan,
  expectedFlaggedCounts,
  FIXTURE_FLAG_KEY,
  FIXTURE_FLAG_SCOPE,
  FIXTURE_PREFIX,
  OWN_ACTOR_ID,
  type SeedStep,
} from './spec.js';
import { verifyFixtureResult, type FixtureResult } from './verify.js';

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
function fakeWorld(opts: { activeScene?: boolean } = {}) {
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
  const users = [
    { id: 'gm1', name: 'dev-gm', isGM: true },
    { id: 'p1', name: 'player1', isGM: false },
  ];
  const game = {
    user: { isGM: true },
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
  return { game, getDocumentClass, Roll, world, scene };
}

async function run(
  w: ReturnType<typeof fakeWorld>,
  mode: 'seed' | 'clean',
): Promise<FixtureResult> {
  const fn = new Function('game', 'getDocumentClass', 'Roll', `return (${FIXTURE_RUNTIME});`)(
    w.game,
    w.getDocumentClass,
    w.Roll,
  ) as (a: unknown) => Promise<FixtureResult>;
  return fn({ mode, plan, flagScope: FIXTURE_FLAG_SCOPE, flagKey: FIXTURE_FLAG_KEY });
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
