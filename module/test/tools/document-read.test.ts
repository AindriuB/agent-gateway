// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { DispatchResult } from '../../src/ops/types.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { fakeDoc, gmUser, playerUser, setupWorld } from './fixtures.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

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
  it('FORBIDDEN for a document the user cannot observe, allowed for a GM', async () => {
    stub = world();
    expect(await get('Actor.h')).toMatchObject({ error: { code: 'FORBIDDEN' } });
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
