// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { isOpError, type OpCall } from '../../src/ops/types.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const agent = { id: 'a1', ownerUserId: 'u1', headless: false };
const call = (tool: string, args: unknown): OpCall => ({ tool, args, agent, sessionId: 's' });
const player = { id: 'u1', isGM: false };

function makePack(
  collection: string,
  documentName: string,
  entries: Array<{ _id: string; name: string; type?: string }>,
  observers: string[] = ['u1'],
) {
  const getIndex = vi.fn(async () => ({ contents: entries }));
  const getDocuments = vi.fn(async () => {
    throw new Error('getDocuments must not be called');
  });
  return {
    collection,
    documentName,
    getIndex,
    getDocuments,
    testUserPermission: (u: any, level: string) => level === 'OBSERVER' && observers.includes(u.id),
  };
}

function setup(packs: any[], docs: Record<string, any> = {}) {
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.system = { id: 'dnd5e' };
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  g.game.users = { get: (id: string) => (id === 'u1' ? { id: 'u1' } : undefined) };
  g.game.packs = {
    contents: packs,
    get: (id: string) => packs.find((p) => p.collection === id),
  };
  g.fromUuid = vi.fn(async (uuid: string) => docs[uuid]);
}

const search = (args: unknown) => dispatch(call('compendium_search', args), player);

describe('compendium_search', () => {
  it('uses indexes only and never loads documents', async () => {
    const a = makePack('w.items', 'Item', [{ _id: 'i1', name: 'Longsword', type: 'weapon' }]);
    const b = makePack('w.actors', 'Actor', [{ _id: 'a1', name: 'Longsword Guard' }]);
    setup([a, b]);
    const r = await search({ query: 'longsword' });
    expect(isOpError(r)).toBe(false);
    if (isOpError(r)) return;
    expect(r.structured.results).toEqual([
      { uuid: 'Compendium.w.items.Item.i1', name: 'Longsword', type: 'weapon', pack: 'w.items' },
      {
        uuid: 'Compendium.w.actors.Actor.a1',
        name: 'Longsword Guard',
        type: 'Actor',
        pack: 'w.actors',
      },
    ]);
    expect(a.getIndex).toHaveBeenCalled();
    expect(a.getDocuments).not.toHaveBeenCalled();
    expect(b.getDocuments).not.toHaveBeenCalled();
  });

  it('filters by packType and pack', async () => {
    const a = makePack('w.items', 'Item', [{ _id: 'i1', name: 'Rope' }]);
    const b = makePack('w.more', 'Item', [{ _id: 'i2', name: 'Rope 2' }]);
    const c = makePack('w.actors', 'Actor', [{ _id: 'a1', name: 'Rope Walker' }]);
    setup([a, b, c]);
    const byType = (await search({ query: 'rope', packType: 'Actor' })) as any;
    expect(byType.structured.results.map((x: any) => x.pack)).toEqual(['w.actors']);
    const byPack = (await search({ query: 'rope', pack: 'w.more' })) as any;
    expect(byPack.structured.results.map((x: any) => x.pack)).toEqual(['w.more']);
    expect(c.getIndex).toHaveBeenCalledTimes(1);
  });

  it('skips packs the user cannot observe, without reading their index', async () => {
    const hidden = makePack('w.secret', 'Item', [{ _id: 'x', name: 'Secret sword' }], []);
    const open = makePack('w.open', 'Item', [{ _id: 'y', name: 'Open sword' }]);
    setup([hidden, open]);
    const r = (await search({ query: 'sword' })) as any;
    expect(r.structured.results.map((x: any) => x.pack)).toEqual(['w.open']);
    expect(hidden.getIndex).not.toHaveBeenCalled();
  });

  it('applies the limit (default 20, max 50) and reports truncation', async () => {
    const entries = Array.from({ length: 60 }, (_, i) => ({ _id: `e${i}`, name: `Orc ${i}` }));
    setup([makePack('w.m', 'Actor', entries)]);
    const def = (await search({ query: 'orc' })) as any;
    expect(def.structured.results).toHaveLength(20);
    expect(def.structured.truncated).toBe(true);
    const max = (await search({ query: 'orc', limit: 50 })) as any;
    expect(max.structured.results).toHaveLength(50);
    expect(await search({ query: 'orc', limit: 51 })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    const few = (await search({ query: 'orc 59', limit: 5 })) as any;
    expect(few.structured.truncated).toBe(false);
  });

  it('rejects an unknown packType', async () => {
    setup([]);
    expect(await search({ query: 'a', packType: 'Cards' })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });

  it('escapes untrusted names in the text result', async () => {
    setup([
      makePack('w.i', 'Item', [
        { _id: 'i', name: '# [x](javascript:1) <img src=x onerror=1>\n- hi' },
      ]),
    ]);
    const r = (await search({ query: 'img' })) as any;
    expect(r.text).not.toMatch(/<img/);
    expect(r.text).toContain('\\[x\\]');
    expect(r.text.split('\n')).toHaveLength(2);
  });
});

describe('compendium_get', () => {
  const uuid = 'Compendium.w.journals.JournalEntry.j1';
  const entry = (html: string, extra: Record<string, unknown> = {}) => ({
    documentName: 'JournalEntry',
    name: 'Lore',
    toObject: () => ({
      name: 'Lore',
      pages: [{ text: { content: html } }],
      flags: { core: { a: 1 }, evil: { secret: 'x' }, 'agent-gateway': { ok: 1 } },
      ...extra,
    }),
  });
  const get = (args: unknown, user = player) => dispatch(call('compendium_get', args), user);

  it('returns markdown for an observable entry', async () => {
    setup([makePack('w.journals', 'JournalEntry', [])], {
      [uuid]: entry('<p>Hello <b>world</b></p><script>alert(1)</script>'),
    });
    const r = (await get({ uuid })) as any;
    expect(r.structured).toMatchObject({
      uuid,
      name: 'Lore',
      type: 'JournalEntry',
      pack: 'w.journals',
    });
    expect(r.structured.markdown).toContain('Hello **world**');
    expect(r.structured.markdown).not.toContain('alert');
    expect(r.structured.nextCursor).toBeUndefined();
  });

  it('pages with a cursor and reassembles the whole entry', async () => {
    const words = Array.from({ length: 4000 }, (_, i) => `w${i}`).join(' ');
    setup([makePack('w.journals', 'JournalEntry', [])], { [uuid]: entry(`<p>${words}</p>`) });
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = (await get({ uuid, cursor })) as any;
      seen.push(r.structured.markdown);
      cursor = r.structured.nextCursor;
      if (!cursor) break;
    }
    expect(seen.length).toBeGreaterThan(1);
    const joined = seen.join(' ');
    for (const i of [0, 1999, 3999]) expect(joined).toContain(`w${i}`);
  });

  it('rejects a forged cursor without throwing', async () => {
    setup([makePack('w.journals', 'JournalEntry', [])], { [uuid]: entry('<p>x</p>') });
    const r = (await get({ uuid, cursor: 'p1.deadbeef.1.1.1' })) as any;
    expect(r.structured.error).toMatch(/cursor/i);
    expect(r.structured.markdown).toBe('');
  });

  it('rejects non-compendium uuids', async () => {
    setup([], {});
    const r = (await get({ uuid: 'Actor.abc' })) as any;
    expect(r.structured.error).toMatch(/Compendium/);
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
  });

  it('does not load entries from packs the user cannot observe', async () => {
    setup([makePack('w.journals', 'JournalEntry', [], [])], { [uuid]: entry('<p>x</p>') });
    const r = (await get({ uuid })) as any;
    expect(r.structured.error).toBe('Compendium entry not found.');
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('Lore');
  });

  it('does not expose other modules data in the entry', async () => {
    setup([makePack('w.journals', 'JournalEntry', [])], {
      [uuid]: entry('<p>x</p>', { system: { description: { value: '<p>sys</p>' } } }),
    });
    const r = (await get({ uuid })) as any;
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(r.structured.markdown).toContain('sys');
  });

  it('escapes a hostile name and neutralises markup in content', async () => {
    const e = entry('<p>[click](javascript:alert(1)) <img src=x onerror=alert(1)></p>');
    e.toObject = () => ({ name: '# <b>boom</b>', pages: [{ text: { content: '<p>[a](b)</p>' } }] });
    setup([makePack('w.journals', 'JournalEntry', [])], { [uuid]: e });
    const r = (await get({ uuid })) as any;
    expect(r.text).not.toMatch(/<b>|<img/);
    expect(r.structured.markdown).toContain('\\[a\\]');
  });
});
