// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { isOpError, type OpCall } from '../../src/ops/types.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { codeField, fakeDoc, gmUser, htmlField, ownerUser, playerUser } from '../stubs/world.js';

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
  const users = [{ id: 'u1' }, gmUser, playerUser, ownerUser];
  g.game.users = { get: (id: string) => users.find((u) => u.id === id) };
  g.foundry.data = {
    fields: { HTMLField: htmlField.constructor, JavaScriptField: codeField.constructor },
  };
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
  const WATCHERS = ['p1', 'p2', 'gm1'];
  const pageSchema = { name: {}, text: { fields: { content: htmlField } } };
  const mkPage = (content: string, extra: Record<string, unknown> = {}) =>
    fakeDoc({
      id: 'pg',
      name: 'Page',
      documentName: 'JournalEntryPage',
      observers: WATCHERS,
      schema: pageSchema,
      data: { text: { content } },
      ...extra,
    });
  const journal = (content: string, extra: Record<string, unknown> = {}, page = mkPage(content)) =>
    fakeDoc({
      id: 'j1',
      name: 'Lore',
      uuid,
      documentName: 'JournalEntry',
      observers: WATCHERS,
      embedded: { pages: [page] },
      ...extra,
    });
  const run = (d: any, user: any = playerUser, args: Record<string, unknown> = {}) => {
    setup([makePack('w.journals', 'JournalEntry', [], WATCHERS)], { [d.uuid]: d });
    return dispatch(call('compendium_get', { uuid: d.uuid, ...args }), user) as Promise<any>;
  };
  const get = (args: unknown, user: any = playerUser) =>
    dispatch(call('compendium_get', args), user) as Promise<any>;
  const md = (r: any): string => {
    if ('error' in r) throw new Error(JSON.stringify(r.error));
    return r.structured.markdown;
  };

  it('returns markdown for an observable entry', async () => {
    const r = await run(journal('<p>Hello <b>world</b></p><script>alert(1)</script>'));
    expect(r.structured).toMatchObject({
      uuid,
      name: 'Lore',
      type: 'JournalEntry',
      pack: 'w.journals',
    });
    expect(md(r)).toContain('Hello **world**');
    expect(md(r)).not.toContain('alert');
    expect(r.structured.nextCursor).toBeUndefined();
  });

  it('pages with a cursor and reassembles the whole entry', async () => {
    const words = Array.from({ length: 4000 }, (_, i) => `w${i}`).join(' ');
    const d = journal(`<p>${words}</p>`);
    let cursor: string | undefined;
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      const r = await run(d, playerUser, cursor ? { cursor } : {});
      seen.push(md(r));
      cursor = r.structured.nextCursor;
      if (!cursor) break;
    }
    expect(seen.length).toBeGreaterThan(1);
    const joined = seen.join(' ');
    for (const i of [0, 1999, 3999]) expect(joined).toContain(`w${i}`);
  });

  it('rejects a forged cursor with INVALID_ARGS', async () => {
    const r = await run(journal('<p>x</p>'), playerUser, { cursor: 'p1.deadbeef.1.1.1' });
    expect(r).toMatchObject({
      error: { code: 'INVALID_ARGS', message: expect.stringMatching(/cursor/i) },
    });
  });

  it('rejects non-compendium uuids', async () => {
    setup([], {});
    const r = await get({ uuid: 'Actor.abc' });
    expect(r).toMatchObject({
      error: { code: 'INVALID_ARGS', message: expect.stringMatching(/Compendium/) },
    });
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
  });

  it('does not load entries from packs the user cannot observe', async () => {
    setup([makePack('w.journals', 'JournalEntry', [], [])], { [uuid]: journal('<p>x</p>') });
    const r = await get({ uuid });
    expect(r).toEqual({ error: { code: 'INVALID_ARGS', message: 'Compendium entry not found.' } });
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('Lore');
  });

  it('answers a missing pack exactly like a hidden one', async () => {
    setup([], { [uuid]: journal('<p>x</p>') });
    expect(await get({ uuid })).toEqual({
      error: { code: 'INVALID_ARGS', message: 'Compendium entry not found.' },
    });
  });

  it('does not expose other modules data in the entry', async () => {
    const d = journal('<p>x</p>', {
      data: { flags: { core: { a: 1 }, evil: { secret: 'LEAKED' } } },
    });
    expect(JSON.stringify(await run(d))).not.toContain('LEAKED');
  });

  it('escapes a hostile name and neutralises markup in content', async () => {
    const d = journal('<p>[a](b) <img src=x onerror=alert(1)></p>', {
      name: '# <b>boom</b>',
      data: { name: '# <b>boom</b>' },
    });
    const r = await run(d);
    expect(r.text).not.toMatch(/<b>|<img/);
    expect(md(r)).toContain('\\[a\\]');
  });

  describe('names are inert in text results (shared inlineText)', () => {
    it('search: a heading-looking and an autolink-looking name', async () => {
      setup([
        makePack('w.i', 'Item', [
          { _id: 'a', name: '# Pwned' },
          { _id: 'b', name: 'www.x.com' },
        ]),
      ]);
      const r = (await search({ query: 'w' })) as any;
      expect(r.text).toContain('\\# Pwned');
      expect(r.text).not.toContain('- # Pwned');
      expect(r.text).toContain('www\\.x.com');
      expect(r.text).not.toContain('www.x.com');
    });
    it('get: the header line cannot be a heading or a link', async () => {
      for (const [name, bad] of [
        ['# Pwned', /^# /m],
        ['www.x.com', /www\.x\.com/],
      ] as const) {
        const r = await run(journal('<p>x</p>', { name, data: { name } }));
        expect(r.text.split('\n')[0]).not.toMatch(bad);
      }
    });
  });

  describe('secrets and owner-only fields', () => {
    const body =
      '<p>PUBLIC</p><section class="secret"><p>SECRETONE</p></section><p class="secret revealed">REVEALED</p>';
    it('strips unrevealed secrets for a player observer, keeps them for the GM and the page owner', async () => {
      const d = () => journal(body);
      const player = md(await run(d()));
      expect(player).toContain('PUBLIC');
      expect(player).toContain('REVEALED');
      expect(player).not.toContain('SECRETONE');
      expect(md(await run(d(), gmUser))).toContain('SECRETONE');
      const owned = journal(body, {}, mkPage(body, { owners: ['p2'] }));
      const o = md(await run(owned, ownerUser));
      expect(o).toContain('SECRETONE');
      expect(o).toContain('REVEALED');
    });

    it('strips secrets from markup in any string, schema or not', async () => {
      const item = fakeDoc({
        id: 'i1',
        name: 'Blade',
        uuid: 'Compendium.w.journals.Item.i1',
        documentName: 'Item',
        observers: WATCHERS,
        data: { system: { note: '<p>OPEN</p><section class="secret">HIDDENTEXT</section>' } },
      });
      expect(md(await run(item))).not.toContain('HIDDENTEXT');
      expect(md(await run(item))).toContain('OPEN');
      expect(md(await run(item, gmUser))).toContain('HIDDENTEXT');
    });

    it('drops text.markdown for a player and keeps it for the GM', async () => {
      const page = mkPage('<p>RENDERED</p>', {
        data: {
          text: {
            content: '<p>RENDERED</p>',
            markdown: 'MDSOURCE <section class="secret">MDSECRET</section>',
          },
        },
      });
      const d = () => journal('', {}, page);
      const player = md(await run(d()));
      expect(player).toContain('RENDERED');
      expect(player).not.toMatch(/MDSOURCE|MDSECRET/);
      expect(md(await run(d(), gmUser))).toContain('MDSECRET');
    });
  });

  describe('top-level field rules for non-GMs', () => {
    const stats = {
      modifiedTime: 5,
      createdTime: 1,
      createdBy: 'CREATEDBY',
      compendiumSource: 'COMPSRC',
    };
    const macro = () =>
      fakeDoc({
        id: 'm1',
        name: 'Zap',
        uuid: 'Compendium.w.journals.Macro.m1',
        documentName: 'Macro',
        observers: WATCHERS,
        data: {
          ownership: { default: 0, p1: 2, gm1: 3 },
          _stats: stats,
          flags: { core: { sourceId: 'SOURCEID', keepme: 'KEPT' } },
        },
      });
    it('ownership becomes {yours}, _stats is trimmed, sourceId is dropped', async () => {
      const player = md(await run(macro()));
      expect(player).toMatch(/ownership\.yours\*\*: 2/);
      expect(player).not.toMatch(/ownership\.(default|p1|gm1)/);
      expect(player).not.toMatch(/CREATEDBY|COMPSRC|SOURCEID/);
      expect(player).toContain('KEPT');
      const gm = md(await run(macro(), gmUser));
      expect(gm).toMatch(/ownership\.gm1/);
      expect(gm).toContain('CREATEDBY');
      expect(gm).toContain('SOURCEID');
    });
  });

  describe('typed text from the data model', () => {
    it('RollTable results: HTMLField converted, code field fenced', async () => {
      const result = fakeDoc({
        id: 'r1',
        name: 'R',
        documentName: 'TableResult',
        observers: WATCHERS,
        schema: { description: htmlField },
        data: { description: '<b>Gold</b> coins' },
      });
      const table = fakeDoc({
        id: 't1',
        name: 'Loot',
        uuid: 'Compendium.w.journals.RollTable.t1',
        documentName: 'RollTable',
        observers: WATCHERS,
        embedded: { results: [result] },
      });
      expect(md(await run(table))).toContain('**Gold** coins');
    });
    it('Macro command is a fenced code block', async () => {
      const m = fakeDoc({
        id: 'm2',
        name: 'Zap',
        uuid: 'Compendium.w.journals.Macro.m2',
        documentName: 'Macro',
        observers: WATCHERS,
        schema: { command: codeField },
        data: { command: 'const x = "<b>hi</b>";\n```\n# not a heading' },
      });
      const out = md(await run(m));
      const open = /^(`{3,})/m.exec(out)![1]!;
      expect(open.length).toBeGreaterThan(3);
      expect(out).toContain('<b>hi</b>');
    });
  });
});
