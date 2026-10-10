import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  chatProblems,
  COMPENDIUM,
  notFoundProblems,
  overlapProblems,
  playerPublicEntryProblems,
  searchProblems,
  type ChatMsg,
} from '../lib/expect.js';
import {
  limitedPackUuid,
  loadContext,
  PlayerCaller,
  readAllPages,
  requireUuids,
} from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';
import { FIXTURE } from '../fixtures/spec.js';

const ctx = loadContext();
let session: UserSession;
let player: PlayerCaller;

beforeAll(async () => {
  session = await openUserSession(ctx.config, ctx.paths, ctx.config.playerUser);
  player = new PlayerCaller(session.gateway, ctx.paths, ctx.fixtures);
});

afterAll(async () => {
  player?.record();
  await session?.close();
});

const names = (r: { structured?: Record<string, unknown> }): string[] =>
  ((r.structured?.results ?? []) as Array<{ name: string }>).map((x) => x.name);

describe('player journal reads', () => {
  it('document_search lists ag-test-public and no other fixture entry', async () => {
    const r = await player.call('document_search', {
      type: 'JournalEntry',
      query: 'ag-test',
      limit: 50,
    });
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.truncated, 'search was truncated').toBe(false);
    expect(searchProblems('player', names(r))).toEqual([]);
  });

  it.each([
    ['ag-test-hidden', 'hidden'],
    ['ag-test-limited', 'limited'],
    ['the active Scene', 'activeScene'],
  ])('document_get on %s is "not found", never FORBIDDEN', async (_label, key) => {
    const uuid = requireUuids(ctx)[key];
    const r = await player.call('document_get', { uuid });
    expect(notFoundProblems(r)).toEqual([]);
  });

  it('ag-test-public shows the public and markdown pages only, secrets stripped, ownership { yours: 2 }', async () => {
    const found = await player.call('document_search', {
      type: 'JournalEntry',
      query: FIXTURE.names.publicEntry,
    });
    const uuid = (found.structured?.results as Array<{ uuid: string }> | undefined)?.[0]?.uuid;
    expect(uuid).toBeTruthy();
    const content = await readAllPages(
      (extra) => player.call('document_get', { uuid, ...extra }),
      'content',
    );
    expect(playerPublicEntryProblems(content)).toEqual([]);
  });

  it('no scene placeable appears in Scene, Actor or Item searches', async () => {
    for (const type of ['Scene', 'Actor', 'Item']) {
      const r = await player.call('document_search', { type, limit: 50 });
      expect(r.isError, r.text).toBe(false);
    }
    // The leak check already scans each of these results for every placeable name.
    expect(player.leak.summary().hits).toBe(0);
  });
});

describe('player chat', () => {
  it('chat_read shows what Foundry shows and nothing else', async () => {
    const msgs: ChatMsg[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const r = await player.call('chat_read', { limit: 100, ...(before ? { before } : {}) });
      expect(r.isError, r.text).toBe(false);
      for (const m of (r.structured?.messages ?? []) as ChatMsg[]) msgs.push(m);
      before = r.structured?.nextBefore as string | undefined;
      if (!before) break;
    }
    expect(chatProblems('player', msgs)).toEqual([]);
  });
});

describe('player compendium', () => {
  it('hides the LIMITED pack from search and get', async () => {
    const r = await player.call('compendium_search', { query: 'a', limit: 50 });
    expect(r.isError, r.text).toBe(false);
    const packs = ((r.structured?.results ?? []) as Array<{ pack: string }>).map((x) => x.pack);
    expect(packs).not.toContain(COMPENDIUM.limitedPack);
    const inPack = await player.call('compendium_search', {
      query: 'a',
      pack: COMPENDIUM.limitedPack,
    });
    const hit = ((inPack.structured?.results ?? []) as unknown[]).length;
    expect(hit).toBe(0);
    const uuid = limitedPackUuid(ctx.paths);
    const get = await player.call('compendium_get', { uuid });
    expect(notFoundProblems(get)).toEqual([]);
  });

  it.each(COMPENDIUM.observablePacks)('%s returns results', async (pack) => {
    const r = await player.call('compendium_search', { query: 'a', pack, limit: 50 });
    expect(r.isError, r.text).toBe(false);
    expect(((r.structured?.results ?? []) as unknown[]).length).toBeGreaterThan(0);
  });

  it('a long entry has a second page that does not repeat the first', async () => {
    const r = await player.call('compendium_search', {
      query: 'a',
      pack: 'pf2e.journals',
      limit: 50,
    });
    const entries = (r.structured?.results ?? []) as Array<{ uuid: string }>;
    for (const e of entries.slice(0, 15)) {
      const first = await player.call('compendium_get', { uuid: e.uuid });
      const cursor = first.structured?.nextCursor as string | undefined;
      if (!cursor) continue;
      const second = await player.call('compendium_get', { uuid: e.uuid, cursor });
      expect(second.isError, second.text).toBe(false);
      expect(
        overlapProblems(String(first.structured?.markdown), String(second.structured?.markdown)),
      ).toEqual([]);
      return;
    }
    throw new Error('no pf2e.journals entry in the first 15 results has a second page');
  });
});
