// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { folderAllowed } from '../../src/policy/folders.js';
import { folderAllowlist, registerPolicySettings } from '../../src/policy/store.js';
import { clearDocumentCache } from '../../src/tools/document-get.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { fakeDoc, gmUser, playerUser, setupWorld } from '../stubs/world.js';
import { englishI18n, setSetting } from './helpers.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  clearDocumentCache();
});

const agent = { id: 'a1', ownerUserId: 'p1', headless: false };
const call = (tool: string, args: unknown, user: any = playerUser) =>
  dispatch({ tool, args, agent, sessionId: 's' }, user);

// Heroes > Elves > Wood Elves, and an unrelated Villains folder.
const heroes: any = { id: 'heroes', name: 'Heroes' };
const elves: any = { id: 'elves', name: 'Elves', folder: heroes };
const woodElves: any = { id: 'wood', name: 'Wood Elves', folder: elves };
const villains: any = { id: 'villains', name: 'Villains' };

const actor = (id: string, name: string, folder?: any, extra: object = {}) =>
  fakeDoc({
    id,
    name,
    documentName: 'Actor',
    observers: ['p1'],
    folder,
    data: { note: name },
    ...extra,
  });
const docs = () => [
  actor('hero', 'Hero', heroes),
  actor('elf', 'Elf', elves),
  actor('wood', 'Woodsman', woodElves),
  actor('vil', 'Villain', villains),
  actor('loose', 'Loose'),
];

function world(allow?: { playerAgents?: string[]; gmAgents?: string[] }) {
  stub = setupWorld({ docs: { actors: docs() } });
  (globalThis as any).game.i18n = englishI18n;
  registerPolicySettings();
  return allow ? setSetting('folderAllowlist', JSON.stringify(allow)) : Promise.resolve();
}
const names = async (user: any = playerUser) =>
  ((await call('document_search', { type: 'Actor' }, user)) as any).structured.results
    .map((r: any) => r.name)
    .sort();

describe('folder allowlist', () => {
  it('no allowlist: everything is visible', async () => {
    await world();
    expect(await names()).toEqual(['Elf', 'Hero', 'Loose', 'Villain', 'Woodsman']);
  });

  it('an empty list for the class means no restriction', async () => {
    await world({ playerAgents: [], gmAgents: ['villains'] });
    expect(await names()).toHaveLength(5);
  });

  it('search omits documents outside the list, keeping listed folders and their subfolders', async () => {
    await world({ playerAgents: ['heroes'] });
    expect(await names()).toEqual(['Elf', 'Hero', 'Woodsman']);
  });

  it('a subfolder listed alone does not admit its parent', async () => {
    await world({ playerAgents: ['elves'] });
    expect(await names()).toEqual(['Elf', 'Woodsman']);
  });

  it('a document with no folder is outside a non-empty list', async () => {
    await world({ playerAgents: ['villains'] });
    expect(await names()).toEqual(['Villain']);
  });

  it('is per agent class: a player list does not limit a GM agent, and vice versa', async () => {
    await world({ playerAgents: ['villains'], gmAgents: ['heroes'] });
    expect(await names(playerUser)).toEqual(['Villain']);
    expect(await names(gmUser)).toEqual(['Elf', 'Hero', 'Woodsman']);
  });

  it('total and truncation reflect only allowed documents', async () => {
    await world({ playerAgents: ['villains'] });
    const r = (await call('document_search', { type: 'Actor' })) as any;
    expect(r.structured.total).toBe(1);
  });

  it('accepts a Folder.<id> uuid in the list', async () => {
    await world({ playerAgents: ['Folder.villains'] });
    expect(await names()).toEqual(['Villain']);
  });

  it('a corrupt allowlist hides everything rather than nothing', async () => {
    await world();
    await setSetting('folderAllowlist', '{not json');
    expect(await names()).toEqual([]);
    expect(folderAllowlist('playerAgents')).toHaveLength(1);
    await setSetting('folderAllowlist', JSON.stringify({ playerAgents: 'villains' }));
    expect(await names()).toEqual([]);
  });

  it('survives a folder cycle', async () => {
    await world({ playerAgents: ['x'] });
    const a: any = { id: 'a' };
    const b: any = { id: 'b', folder: a };
    a.folder = b;
    expect(folderAllowed({ folder: a }, false)).toBe(false);
  });
});

describe('document_get with a folder allowlist', () => {
  const get = (uuid: string, user: any = playerUser) =>
    call('document_get', { uuid }, user) as Promise<any>;

  it('reads a document inside the list and in a subfolder', async () => {
    await world({ playerAgents: ['heroes'] });
    expect((await get('Actor.hero')).structured.name).toBe('Hero');
    expect((await get('Actor.wood')).structured.name).toBe('Woodsman');
  });

  it('a document outside the list answers exactly like a missing one: INVALID_ARGS not found', async () => {
    await world({ playerAgents: ['heroes'] });
    const outside = await get('Actor.vil');
    const missing = await get('Actor.nope');
    expect(outside).toEqual({
      error: { code: 'INVALID_ARGS', message: 'Document "Actor.vil" not found' },
    });
    expect(outside.error.code).not.toBe('FORBIDDEN');
    // Same shape as a missing document; only the uuid echoed back differs.
    expect(JSON.parse(JSON.stringify(outside).replaceAll('Actor.vil', 'Actor.nope'))).toEqual(
      missing,
    );
  });

  it('is identical to a document the user cannot observe', async () => {
    await world({ playerAgents: ['heroes'] });
    stub.uninstall();
    stub = setupWorld({
      docs: {
        actors: [
          ...docs(),
          fakeDoc({
            id: 'hid',
            name: 'Hidden',
            documentName: 'Actor',
            observers: [],
            folder: heroes,
          }),
        ],
      },
    });
    (globalThis as any).game.i18n = englishI18n;
    registerPolicySettings();
    await setSetting('folderAllowlist', JSON.stringify({ playerAgents: ['heroes'] }));
    const hidden = await get('Actor.hid');
    const outside = await get('Actor.vil');
    expect(JSON.parse(JSON.stringify(hidden).replaceAll('Actor.hid', 'Actor.vil'))).toEqual(
      outside,
    );
  });

  it('embedded uuids agree with their root', async () => {
    const item = fakeDoc({ id: 'sw', name: 'Sword', documentName: 'Item', observers: ['p1'] });
    const owner = fakeDoc({
      id: 'carrier',
      name: 'Carrier',
      documentName: 'Actor',
      observers: ['p1'],
      folder: villains,
      embedded: { items: [item] },
    });
    stub = setupWorld({ docs: { actors: [owner] } });
    (globalThis as any).game.i18n = englishI18n;
    registerPolicySettings();
    await setSetting('folderAllowlist', JSON.stringify({ playerAgents: ['heroes'] }));
    // The actor's own uuid and the embedded item's uuid both read as missing.
    const root = await get('Actor.carrier');
    const embedded = await get('Actor.carrier.Item.sw');
    expect(root.error.code).toBe('INVALID_ARGS');
    expect(embedded.error.code).toBe('INVALID_ARGS');
    await setSetting('folderAllowlist', JSON.stringify({ playerAgents: ['villains'] }));
    expect((await get('Actor.carrier.Item.sw')).structured?.name).toBe('Sword');
  });

  it('applies to GM agents too, with the GM list', async () => {
    await world({ gmAgents: ['heroes'] });
    expect((await get('Actor.vil', gmUser)).error.message).toContain('not found');
    expect((await get('Actor.hero', gmUser)).structured.name).toBe('Hero');
    // The player list is empty, so a player agent is unrestricted.
    expect((await get('Actor.vil')).structured.name).toBe('Villain');
  });
});
