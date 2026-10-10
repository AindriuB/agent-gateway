// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { DispatchResult } from '../../src/ops/types.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { clearDocumentCache } from '../../src/tools/document-get.js';
import { expectInertSpan, HOSTILE_NAMES } from '../stubs/inert.js';
import {
  codeField,
  fakeDoc,
  gmUser,
  htmlField,
  ownerUser,
  playerUser,
  setupWorld,
} from '../stubs/world.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  clearDocumentCache();
});

const agent = { id: 'a1', ownerUserId: 'p1', headless: false };
const call = (tool: string, args: unknown, user = playerUser): Promise<DispatchResult> =>
  dispatch({ tool, args, agent, sessionId: 's' }, user);
const structured = (r: DispatchResult): any => {
  if ('error' in r) throw new Error(JSON.stringify(r.error));
  return r.structured;
};

describe('document_search', () => {
  const actors = [
    fakeDoc({ id: 'a', name: 'Zed Goblin', documentName: 'Actor', observers: ['p1'] }),
    fakeDoc({
      id: 'b',
      name: 'Alice',
      documentName: 'Actor',
      observers: ['p1'],
      folder: { id: 'f1', name: 'Heroes' },
    }),
    fakeDoc({ id: 'c', name: 'Secret Villain', documentName: 'Actor', observers: [] }),
  ];
  const world = () => setupWorld({ docs: { actors } });

  it('lists only documents the user can observe, sorted by name', async () => {
    stub = world();
    const out = structured(await call('document_search', { type: 'Actor' }));
    expect(out.results.map((r: any) => r.name)).toEqual(['Alice', 'Zed Goblin']);
    expect(out.results[0]).toEqual({
      uuid: 'Actor.b',
      name: 'Alice',
      type: 'Actor',
      folder: 'Heroes',
    });
    expect(JSON.stringify(out)).not.toContain('Secret Villain');
  });
  it('a GM sees everything', async () => {
    stub = world();
    const out = structured(await call('document_search', { type: 'Actor' }, gmUser));
    expect(out.total).toBe(3);
  });
  it('does not leak hidden names through query or total', async () => {
    stub = world();
    const out = structured(await call('document_search', { type: 'Actor', query: 'villain' }));
    expect(out).toMatchObject({ results: [], total: 0, truncated: false });
  });
  it('filters by query and folder (name or id), case-insensitively', async () => {
    stub = world();
    expect(structured(await call('document_search', { type: 'Actor', query: 'GOB' })).total).toBe(
      1,
    );
    expect(
      structured(await call('document_search', { type: 'Actor', folder: 'heroes' })).total,
    ).toBe(1);
    expect(structured(await call('document_search', { type: 'Actor', folder: 'f1' })).total).toBe(
      1,
    );
  });
  it('defaults the limit to 20 and caps it at 50', async () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      fakeDoc({ id: `n${i}`, name: `Item ${i}`, documentName: 'Item', observers: ['p1'] }),
    );
    stub = setupWorld({ docs: { items: many } });
    const dflt = structured(await call('document_search', { type: 'Item' }));
    expect(dflt.results).toHaveLength(20);
    expect(dflt).toMatchObject({ total: 60, truncated: true });
    expect(
      structured(await call('document_search', { type: 'Item', limit: 50 })).results,
    ).toHaveLength(50);
    expect(await call('document_search', { type: 'Item', limit: 51 })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });
  it('rejects an unknown type', async () => {
    stub = world();
    expect(await call('document_search', { type: 'ChatMessage' })).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });
  it.each([
    ['Item', 'items'],
    ['JournalEntry', 'journal'],
    ['Scene', 'scenes'],
    ['RollTable', 'tables'],
    ['Macro', 'macros'],
    ['Playlist', 'playlists'],
  ])('searches %s', async (type, key) => {
    stub = setupWorld({
      docs: { [key]: [fakeDoc({ id: 'x', name: 'Thing', documentName: type, observers: ['p1'] })] },
    });
    const out = structured(await call('document_search', { type }));
    expect(out.results).toEqual([{ uuid: `${type}.x`, name: 'Thing', type, folder: '' }]);
  });
});

describe('document_get', () => {
  const journal = fakeDoc({
    id: 'j',
    name: 'Lore',
    documentName: 'JournalEntry',
    observers: ['p1'],
    data: {
      flags: { core: { a: 1 }, 'other-module': { secret: 'LEAK' } },
      pages: [
        {
          _id: 'pg',
          name: 'Intro',
          text: { content: '<h2>Welcome</h2><p>Hello <strong>brave</strong> hero</p>' },
          flags: { 'other-module': { secret: 'LEAK2' } },
        },
      ],
    },
  });
  const hidden = fakeDoc({ id: 'h', name: 'Hidden', documentName: 'Actor', observers: [] });
  const long = fakeDoc({
    id: 'l',
    name: 'Long',
    documentName: 'JournalEntry',
    observers: ['p1'],
    data: {
      pages: [
        {
          text: {
            content: Array.from(
              { length: 1500 },
              (_, i) => `<p>Paragraph ${i} of the long text.</p>`,
            ).join(''),
          },
        },
      ],
    },
  });
  const world = () =>
    setupWorld({ docs: { journal: [journal, long], actors: [hidden] }, optIn: false });
  const get = (uuid: string, cursor?: string, user = playerUser) =>
    call('document_get', cursor ? { uuid, cursor } : { uuid }, user);

  it('returns markdown for HTML fields and the document identity', async () => {
    stub = world();
    const out = structured(await get('JournalEntry.j'));
    expect(out).toMatchObject({ uuid: 'JournalEntry.j', name: 'Lore', type: 'JournalEntry' });
    expect(out.content).toContain('## Welcome');
    expect(out.content).toContain('Hello **brave** hero');
    expect(out.content).not.toContain('<p>');
    expect(out.nextCursor).toBeUndefined();
  });
  it('strips other modules flags and keeps core flags', async () => {
    stub = world();
    const out = structured(await get('JournalEntry.j'));
    expect(out.content).not.toContain('LEAK');
    expect(out.content).not.toContain('other-module');
    expect(out.content).toContain('flags.core.a');
  });
  it('an unobservable document is indistinguishable from a missing one; a GM can read it', async () => {
    stub = world();
    const hiddenRes = await get('Actor.h');
    const missingRes = await get('Actor.nope');
    expect(hiddenRes).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect('error' in hiddenRes && hiddenRes.error.message).toMatch(/not found/);
    expect(JSON.stringify(hiddenRes).replace('Actor.h', 'X')).toBe(
      JSON.stringify(missingRes).replace('Actor.nope', 'X'),
    );
    expect(structured(await get('Actor.h', undefined, gmUser)).name).toBe('Hidden');
  });
  it('INVALID_ARGS not found for an unknown uuid, also when resolution throws', async () => {
    stub = world();
    const r = await get('Actor.nope');
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect('error' in r && r.error.message).toMatch(/not found/);
    (globalThis as any).fromUuid = async () => {
      throw new Error('bad uuid');
    };
    expect(await get('garbage')).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  });
  it('pages with a cursor that round-trips to the whole document', async () => {
    stub = world();
    const pages: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 100; i++) {
      const out = structured(await get('JournalEntry.l', cursor));
      pages.push(out.content);
      cursor = out.nextCursor;
      if (!cursor) break;
    }
    expect(pages.length).toBeGreaterThan(2);
    expect(cursor).toBeUndefined();
    const all = pages.join('\n');
    expect(all).toContain('Paragraph 0 of');
    expect(all).toContain('Paragraph 1499 of');
    expect(pages.every((p) => p.length <= 8000)).toBe(true);
    // Same cursor, same page.
    const first = structured(await get('JournalEntry.l'));
    const again = structured(await get('JournalEntry.l', first.nextCursor));
    expect(again.content).toBe(structured(await get('JournalEntry.l', first.nextCursor)).content);
    expect(again.content).not.toBe(first.content);
  });
  it('rejects a forged or foreign cursor as INVALID_ARGS', async () => {
    stub = world();
    expect(await get('JournalEntry.l', 'p1.deadbeef.0.0.0')).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    const first = structured(await get('JournalEntry.l'));
    expect(await get('JournalEntry.j', first.nextCursor)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });
  it('keeps other modules flags only when the setting opts in', async () => {
    stub = setupWorld({ docs: { journal: [journal] }, optIn: true });
    expect(structured(await get('JournalEntry.j')).content).toContain('LEAK');
  });
});

const pageSchema = { name: {}, text: { fields: { content: htmlField } } };
const mkPage = (id: string, content: string, extra: object = {}) =>
  fakeDoc({
    id,
    name: `Page ${id}`,
    documentName: 'JournalEntryPage',
    ownership: true,
    schema: pageSchema,
    data: { text: { content } },
    ...extra,
  });
const text = (r: DispatchResult): string => {
  if ('error' in r) throw new Error(JSON.stringify(r.error));
  return String(r.structured.content);
};
const get2 = (uuid: string, user = playerUser, cursor?: string) =>
  call('document_get', cursor ? { uuid, cursor } : { uuid }, user);

describe('document_get embedded documents', () => {
  const journal = () =>
    fakeDoc({
      id: 'ej',
      name: 'Embedded',
      documentName: 'JournalEntry',
      observers: ['p1'],
      embedded: {
        pages: [
          mkPage('seen', '<p>VISIBLEBODY</p>', { observers: ['p1'] }),
          mkPage('none', '<p>HIDDENBODY</p>', { observers: [] }),
        ],
      },
    });
  const scene = () =>
    fakeDoc({
      id: 'sc',
      name: 'Map',
      documentName: 'Scene',
      observers: ['p1'],
      embedded: {
        tokens: [
          fakeDoc({
            id: 't1',
            name: 'Open',
            documentName: 'Token',
            ownership: false,
            data: { label: 'OPENTOKEN' },
          }),
          fakeDoc({
            id: 't2',
            observers: ['p1'],
            name: 'Lurker',
            documentName: 'Token',
            ownership: false,
            hidden: true,
            data: { label: 'HIDDENTOKEN' },
          }),
        ],
        drawings: [
          fakeDoc({
            id: 'd1',
            observers: ['p1'],
            name: 'D',
            documentName: 'Drawing',
            ownership: false,
            hidden: true,
            data: { text: 'GMDRAWING' },
          }),
        ],
        notes: [
          fakeDoc({
            id: 'n1',
            name: 'N',
            documentName: 'Note',
            ownership: false,
            data: { text: 'OKNOTE' },
            entry: fakeDoc({
              id: 'je',
              name: 'E',
              documentName: 'JournalEntry',
              observers: ['p1'],
            }),
          }),
          fakeDoc({
            id: 'n2',
            name: 'N',
            documentName: 'Note',
            ownership: false,
            data: { text: 'GMNOTE' },
            entry: fakeDoc({ id: 'jx', name: 'X', documentName: 'JournalEntry' }),
          }),
          fakeDoc({
            id: 'n3',
            name: 'N',
            documentName: 'Note',
            ownership: false,
            data: { text: 'ORPHANNOTE' },
          }),
        ],
      },
    });

  it('omits a page the user cannot observe; the GM sees both', async () => {
    stub = setupWorld({ docs: { journal: [journal()] } });
    const player = text(await get2('JournalEntry.ej'));
    expect(player).toContain('VISIBLEBODY');
    expect(player).not.toContain('HIDDENBODY');
    expect(player).not.toContain('Page none');
    const gm = text(await get2('JournalEntry.ej', gmUser));
    expect(gm).toContain('VISIBLEBODY');
    expect(gm).toContain('HIDDENBODY');
  });
  it('omits hidden tokens, hidden drawings and GM-only notes; the GM sees all', async () => {
    stub = setupWorld({ docs: { scenes: [scene()] } });
    const player = text(await get2('Scene.sc'));
    expect(player).toContain('OPENTOKEN');
    expect(player).toContain('OKNOTE');
    for (const secret of ['HIDDENTOKEN', 'GMDRAWING', 'GMNOTE', 'ORPHANNOTE'])
      expect(player).not.toContain(secret);
    const gm = text(await get2('Scene.sc', gmUser));
    for (const s of ['OPENTOKEN', 'HIDDENTOKEN', 'GMDRAWING', 'OKNOTE', 'GMNOTE', 'ORPHANNOTE'])
      expect(gm).toContain(s);
  });
  it('an embedded document the user cannot see is not found by uuid', async () => {
    stub = setupWorld({ docs: { journal: [journal()], scenes: [scene()] } });
    for (const uuid of [
      'JournalEntry.ej.JournalEntryPage.none',
      'Scene.sc.Token.t2',
      'Scene.sc.Drawing.d1',
    ]) {
      const r = await get2(uuid);
      expect(r, uuid).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      expect('error' in r && r.error.message).toMatch(/not found/);
    }
    expect(text(await get2('JournalEntry.ej.JournalEntryPage.seen'))).toContain('VISIBLEBODY');
    expect(text(await get2('Scene.sc.Token.t2', gmUser))).toContain('HIDDENTOKEN');
  });
});

describe('document_get secrets', () => {
  const body =
    '<p>PUBLIC</p><section class="secret"><p>SECRETONE</p><div class="secret">NESTEDSECRET</div></section><p>AFTER</p>';
  const journal = () =>
    fakeDoc({
      id: 'sj',
      name: 'Secrets',
      documentName: 'JournalEntry',
      observers: ['p1', 'p2'],
      owners: ['p2'],
      embedded: {
        pages: [mkPage('pg', body, { observers: ['p1', 'p2'], owners: ['p2'] })],
      },
    });
  it('hides secrets from an observer, shows them to an owner and a GM', async () => {
    stub = setupWorld({ docs: { journal: [journal()] } });
    const observer = text(await get2('JournalEntry.sj'));
    expect(observer).toContain('PUBLIC');
    expect(observer).toContain('AFTER');
    expect(observer).not.toMatch(/SECRETONE|NESTEDSECRET/);
    for (const user of [ownerUser, gmUser]) {
      const c = text(await get2('JournalEntry.sj', user));
      expect(c).toContain('SECRETONE');
      expect(c).toContain('NESTEDSECRET');
    }
  });
  it('uses the ownership of the document that holds the field', async () => {
    const j = fakeDoc({
      id: 'sk',
      name: 'Owned journal',
      documentName: 'JournalEntry',
      observers: ['p2'],
      owners: ['p2'],
      embedded: { pages: [mkPage('pg2', body, { observers: ['p2'] })] },
    });
    stub = setupWorld({ docs: { journal: [j] } });
    expect(text(await get2('JournalEntry.sk', ownerUser))).not.toContain('SECRETONE');
  });
  it('strips secrets from a top-level HTML field for a non-owner', async () => {
    const actor = fakeDoc({
      id: 'bio',
      name: 'Bio',
      documentName: 'Actor',
      observers: ['p1'],
      schema: { system: { fields: { bio: htmlField } } },
      data: { system: { bio: body } },
    });
    actor.system = { schema: { fields: { bio: htmlField } } };
    stub = setupWorld({ docs: { actors: [actor] } });
    const c = text(await get2('Actor.bio'));
    expect(c).toContain('PUBLIC');
    expect(c).not.toContain('SECRETONE');
    expect(text(await get2('Actor.bio', gmUser))).toContain('SECRETONE');
  });
});

describe('document_get field types', () => {
  const macro = fakeDoc({
    id: 'm',
    name: 'Macro',
    documentName: 'Macro',
    observers: ['p1'],
    schema: { command: codeField, note: {}, desc: htmlField },
    data: {
      command: 'if (a<b && c>d) go()\nreturn 1',
      note: 'line1\nline2 <script>x</script>',
      desc: '<p>Rich <em>text</em></p>',
    },
  });
  it('renders a code field as a fenced block, plain text with newlines, HTML as markdown', async () => {
    stub = setupWorld({ docs: { macros: [macro] } });
    const c = text(await get2('Macro.m'));
    expect(c).toMatch(/```\nif \(a<b && c>d\) go\(\)\nreturn 1\n```/);
    expect(c).toMatch(/line1\s*\n\s*line2/);
    expect(c).not.toMatch(/<script/);
    expect(c).toContain('Rich *text*');
  });
  it('treats a markup-looking string in a plain field as text, not HTML', async () => {
    const m = fakeDoc({
      id: 'm2',
      name: 'M2',
      documentName: 'Macro',
      observers: ['p1'],
      schema: { note: {} },
      data: { note: '<p class="secret">NOTHTML</p>' },
    });
    stub = setupWorld({ docs: { macros: [m] } });
    const c = text(await get2('Macro.m2'));
    expect(c).toContain('NOTHTML');
    expect(c).not.toMatch(/<p/);
  });
});

describe('document_get uuid scope', () => {
  it.each([
    ['Compendium.dnd5e.items.Item.abc', /compendium_get/],
    ['ChatMessage.abc', /only/],
    ['User.abc', /only/],
    ['Setting.abc', /only/],
    ['Folder.abc', /only/],
  ])('refuses %s', async (uuid, msg) => {
    stub = setupWorld();
    const r = await get2(uuid, gmUser);
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect('error' in r && r.error.message).toMatch(msg);
  });
});

describe('document_get cache', () => {
  const mk = (id: string, content: string, modifiedTime = 1) =>
    fakeDoc({
      id,
      name: id,
      documentName: 'Macro',
      observers: ['p1'],
      modifiedTime,
      schema: { note: {} },
      data: { note: content },
    });
  const long = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
  it('does not re-serialise for later pages, and rebuilds when the document changes', async () => {
    const m = mk('c1', long);
    stub = setupWorld({ docs: { macros: [m] } });
    const first = structured(await get2('Macro.c1'));
    expect(first.nextCursor).toBeDefined();
    structured(await get2('Macro.c1', playerUser, first.nextCursor));
    expect(m.toObjectCalls.count).toBe(1);
    m.data.note = `${long} changed`;
    m._stats.modifiedTime = 2;
    structured(await get2('Macro.c1'));
    expect(m.toObjectCalls.count).toBe(2);
  });
  it('is bounded: old entries are evicted', async () => {
    const macros = Array.from({ length: 12 }, (_, i) => mk(`b${i}`, 'x'));
    stub = setupWorld({ docs: { macros } });
    for (const m of macros) await get2(`Macro.${m.id}`);
    await get2('Macro.b0');
    expect(macros[0]!.toObjectCalls.count).toBe(2);
    await get2('Macro.b11');
    expect(macros[11]!.toObjectCalls.count).toBe(1);
  });
  it('keeps users apart', async () => {
    const m = mk('c2', 'x');
    stub = setupWorld({ docs: { macros: [m] } });
    await get2('Macro.c2');
    await get2('Macro.c2', gmUser);
    expect(m.toObjectCalls.count).toBe(2);
  });
});

describe('document_get stale cursor', () => {
  it('says the document changed when the cursor is from another version', async () => {
    const long = Array.from({ length: 3000 }, (_, i) => `word${i}`).join(' ');
    const m = fakeDoc({
      id: 'sc1',
      name: 'S',
      documentName: 'Macro',
      observers: ['p1'],
      schema: { note: {} },
      data: { note: long },
    });
    stub = setupWorld({ docs: { macros: [m] } });
    const first = structured(await get2('Macro.sc1'));
    m.data.note = `${long} more`;
    m._stats.modifiedTime = 5;
    const r = await get2('Macro.sc1', playerUser, first.nextCursor);
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect('error' in r && r.error.message).toMatch(
      /changed since this cursor was issued.*without a cursor/,
    );
    const bad = await get2('Macro.sc1', playerUser, 'nonsense');
    expect('error' in bad && bad.error.message).toBe('Invalid page cursor');
  });
});

describe('tool text escapes names', () => {
  it.each(HOSTILE_NAMES)('document_search and document_get headers: %j', async (name) => {
    const m = fakeDoc({
      id: 'h1',
      name,
      documentName: 'Macro',
      observers: ['p1'],
      folder: { id: 'f', name },
      data: { note: 'x' },
    });
    stub = setupWorld({ docs: { macros: [m] } });
    const search = await call('document_search', { type: 'Macro' });
    const searchText = 'error' in search ? '' : search.text;
    const line = searchText.split('\n').slice(1);
    expect(line).toHaveLength(1);
    expectInertSpan(line[0]!.replace(/^- /, ''));
    const got = await get2('Macro.h1');
    const head = ('error' in got ? '' : got.text).split('\n\n')[0]!;
    expect(head.split('\n')).toHaveLength(1);
    expectInertSpan(head);
  });
});
