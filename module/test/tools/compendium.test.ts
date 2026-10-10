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
  // Field types come from the data model: a schema lists which paths exist and which are HTMLField.
  const fieldsOf = () => (globalThis as any).foundry.data.fields;
  const schemaOf = (spec: Record<string, 'html' | 'string'>) => ({
    getField: (path: string) => {
      const kind = spec[path];
      if (!kind) return null;
      const f = fieldsOf();
      return new (kind === 'html' ? f.HTMLField : f.StringField)();
    },
  });
  const collectionOf = (items: Array<{ _id: string; schema: unknown }>) => ({
    get: (id: string) => items.find((x) => x._id === id),
  });
  const entry = (html: string, extra: Record<string, unknown> = {}) => ({
    documentName: 'JournalEntry',
    name: 'Lore',
    schema: schemaOf({ 'system.description.value': 'html' }),
    pages: collectionOf([{ _id: 'p1', schema: schemaOf({ 'text.content': 'html' }) }]),
    toObject: () => ({
      name: 'Lore',
      pages: [{ _id: 'p1', text: { content: html } }],
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
    expect(r).toMatchObject({
      error: { code: 'INVALID_ARGS', message: expect.stringMatching(/cursor/i) },
    });
  });

  it('rejects non-compendium uuids', async () => {
    setup([], {});
    const r = (await get({ uuid: 'Actor.abc' })) as any;
    expect(r).toMatchObject({
      error: { code: 'INVALID_ARGS', message: expect.stringMatching(/Compendium/) },
    });
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
  });

  it('does not load entries from packs the user cannot observe', async () => {
    setup([makePack('w.journals', 'JournalEntry', [], [])], { [uuid]: entry('<p>x</p>') });
    const r = (await get({ uuid })) as any;
    expect(r).toEqual({ error: { code: 'INVALID_ARGS', message: 'Compendium entry not found.' } });
    expect((globalThis as any).fromUuid).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('Lore');
  });

  it('answers a missing pack exactly like a hidden one', async () => {
    setup([], { [uuid]: entry('<p>x</p>') });
    expect(await get({ uuid })).toEqual({
      error: { code: 'INVALID_ARGS', message: 'Compendium entry not found.' },
    });
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
    e.toObject = () => ({
      name: '# <b>boom</b>',
      pages: [{ _id: 'p1', text: { content: '<p>[a](b)</p>' } }],
    });
    setup([makePack('w.journals', 'JournalEntry', [])], { [uuid]: e });
    const r = (await get({ uuid })) as any;
    expect(r.text).not.toMatch(/<b>|<img/);
    expect(r.structured.markdown).toContain('\\[a\\]');
  });

  describe('rich text by field type', () => {
    const doc = (
      documentName: string,
      spec: Record<string, 'html' | 'string'>,
      data: any,
      extra = {},
    ) => ({
      documentName,
      name: data.name,
      schema: schemaOf(spec),
      toObject: () => data,
      ...extra,
    });
    const run = async (d: any) => {
      const u = `Compendium.w.p.${d.documentName}.x1`;
      setup([makePack('w.p', d.documentName, [])], { [u]: d });
      return (await get({ uuid: u })) as any;
    };

    it('RollTable result text: HTMLField is converted, a plain string field is escaped, not parsed', async () => {
      const table = (kind: 'html' | 'string') =>
        doc(
          'RollTable',
          { description: 'html' },
          {
            name: 'Loot',
            description: '<p>Table <i>intro</i></p>',
            results: [{ _id: 'r1', description: '<b>Gold</b> coins' }],
          },
          { results: collectionOf([{ _id: 'r1', schema: schemaOf({ description: kind }) }]) },
        );
      const html = await run(table('html'));
      expect(html.structured.markdown).toContain('Table *intro*');
      expect(html.structured.markdown).toContain('**Gold** coins');
      const plain = await run(table('string'));
      expect(plain.structured.markdown).toContain('&lt;b>Gold&lt;/b> coins');
      expect(plain.structured.markdown).not.toContain('**Gold**');
    });

    it('RollTable v12 `text` result field is read when the model has it', async () => {
      const t = doc(
        'RollTable',
        {},
        { name: 'Old', results: [{ _id: 'r1', text: 'A <i>rat</i>' }] },
        {
          results: collectionOf([{ _id: 'r1', schema: schemaOf({ text: 'string' }) }]),
        },
      );
      expect((await run(t)).structured.markdown).toContain('A &lt;i>rat&lt;/i>');
    });

    it('Macro command is a fenced code block, never interpreted', async () => {
      const cmd = 'const x = "<b>hi</b>";\n```\n# not a heading\nawait ui.notifications.info(x);';
      const r = await run(
        doc('Macro', { command: 'string' }, { name: 'Zap', type: 'script', command: cmd }),
      );
      const md: string = r.structured.markdown;
      expect(md).toContain('<b>hi</b>');
      expect(md).toMatch(/^(`{3,}|~{3,})/m);
      // The embedded fence cannot close the block: the fence in use is longer than any run in the command.
      const open = /^(`{3,})/m.exec(md)![1]!;
      expect(open.length).toBeGreaterThan(3);
      expect(md.split(open).length).toBe(3);
    });

    it('Macro command is ignored when the model has no such string field', async () => {
      const r = await run(doc('Macro', {}, { name: 'Zap', command: 'secretcode()' }));
      expect(r.structured.markdown).not.toContain('secretcode');
    });

    it('Scene notes text is included as plain text, with HTMLField description as HTML', async () => {
      const scene = doc(
        'Scene',
        { description: 'html' },
        {
          name: 'Cave',
          description: '<p>A <b>dark</b> cave</p>',
          notes: [
            { _id: 'n1', text: 'Trap <b>here</b>' },
            { _id: 'n2', text: '' },
          ],
        },
        {
          notes: collectionOf([
            { _id: 'n1', schema: schemaOf({ text: 'string' }) },
            { _id: 'n2', schema: schemaOf({ text: 'string' }) },
          ]),
        },
      );
      const md: string = (await run(scene)).structured.markdown;
      expect(md).toContain('A **dark** cave');
      expect(md).toContain('Trap &lt;b>here&lt;/b>');
    });

    it('a field absent from the data model is ignored whatever its content', async () => {
      const r = await run(
        doc('Item', {}, { name: 'Odd', description: '<p>phantom</p>', system: {} }),
      );
      expect(r.structured.markdown).not.toContain('phantom');
    });
  });
});
