/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { tableRollHandler } from '../../../src/tools/table-roll.js';
import { playlistControlHandler } from '../../../src/tools/playlist-control.js';
import { ambienceSource } from '../../../src/tools/_ambience.js';
const g = globalThis as any;
const saved = new Map<string, any>();
afterEach(() => {
  for (const [k, v] of saved) g[k] = v;
  saved.clear();
});
function global(k: string, v: any) {
  if (!saved.has(k)) saved.set(k, g[k]);
  g[k] = v;
}
function setup(type: 'Playlist' | 'RollTable', args: any) {
  const user = { id: 'gm', isGM: true, active: true };
  const root: any = {
    documentName: type,
    id: 'r',
    uuid: `${type}.r`,
    _stats: { modifiedTime: 1 },
    testUserPermission: () => true,
    flags: {},
    _source: { formula: '1d6' },
    replacement: false,
    mode: 0,
  };
  const rows: any[] = [];
  const col = { contents: rows, get: (id: string) => rows.find((r) => r.id === id) };
  root[type === 'Playlist' ? 'sounds' : 'results'] = col;
  const docs = new Map([[root.uuid, root]]);
  global('game', {
    user,
    users: { contents: [user], get: (id: string) => (id === user.id ? user : undefined) },
    tables: type === 'RollTable' ? { get: () => root } : undefined,
    playlists: type === 'Playlist' ? { get: () => root } : undefined,
  });
  global('fromUuid', async (uuid: string) => docs.get(uuid));
  global('foundry', {
    utils: {
      parseUuid: (uuid: string) => ({
        type:
          uuid.startsWith('RollTable.') || uuid === 'Compendium.test.tables.entry'
            ? 'RollTable'
            : 'Actor',
      }),
    },
  });
  global('CONST', { PLAYLIST_MODES: { DISABLED: -1, SEQUENTIAL: 0, SHUFFLE: 1, SIMULTANEOUS: 2 } });
  global('document', {
    createElement: () => {
      const template: any = { content: { textContent: '' } };
      Object.defineProperty(template, 'innerHTML', {
        set: (value: string) => {
          template.content.textContent = value.replace(/<[^>]*>/g, '');
        },
      });
      return template;
    },
  });
  const evaluate = vi.fn(async () => ({ total: 2, terms: [] }));
  global(
    'Roll',
    class {
      evaluate = evaluate;
    },
  );
  const create = vi.fn(async () => ({ uuid: 'ChatMessage.new' }));
  global('ChatMessage', { create });
  const ctx: any = {
    args,
    user,
    agent: { id: 'agent' },
    snapshot: vi.fn(async () => {}),
    intendCreate: vi.fn(async () => {}),
    created: vi.fn(async () => {}),
    callOptions: { agentGateway: { callId: 'call' } },
  };
  function child(id: string, extra: any) {
    const row: any = {
      documentName: type === 'Playlist' ? 'PlaylistSound' : 'TableResult',
      id,
      parent: root,
      testUserPermission: () => true,
      ...extra,
    };
    row.uuid = `${root.uuid}.${row.documentName}.${id}`;
    row.toObject = () => {
      const { parent, toObject, testUserPermission, ...data } = row;
      void parent;
      void toObject;
      void testUserPermission;
      return { _id: id, ...data };
    };
    rows.push(row);
    docs.set(row.uuid, row);
    return row;
  }
  root.toObject = () => ({
    _id: 'r',
    formula: root._source.formula,
    mode: root.mode,
    replacement: root.replacement,
    rows: rows.map((r) => r.toObject()),
  });
  return { ctx, root, rows, child, evaluate, create, user };
}
it('draws all overlapping results, forwards audit options and creates no chat when disabled', async () => {
  const f = setup('RollTable', { tableUuid: 'RollTable.r', toChat: false });
  for (const id of ['a', 'b'])
    f.child(id, {
      name: id,
      description: `<b>${id}</b>`,
      type: 'text',
      range: [1, 3],
      drawn: false,
    });
  f.root.updateEmbeddedDocuments = vi.fn(async (type: string, changes: any[], opts: any) => {
    expect(type).toBe('TableResult');
    expect(opts).toBe(f.ctx.callOptions);
    for (const c of changes) f.rows.find((r) => r.id === c._id).drawn = c.drawn;
    return [...f.rows];
  });
  expect(await tableRollHandler(f.ctx)).toMatchObject({
    structured: { results: [{ text: 'a' }, { text: 'b' }] },
  });
  expect(f.ctx.snapshot).toHaveBeenCalledWith('RollTable.r');
  expect(f.create).not.toHaveBeenCalled();
});
it.each(['gmroll', 'blindroll', 'selfroll'])(
  'preserves %s recipients and AI marker',
  async (mode) => {
    const f = setup('RollTable', { tableUuid: 'RollTable.r', rollMode: mode });
    f.root.replacement = true;
    f.child('a', {
      name: 'name',
      description: '<img onerror=x>text',
      type: 'text',
      range: [1, 3],
      drawn: false,
    });
    await tableRollHandler(f.ctx);
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'text',
        whisper: ['gm'],
        flags: { 'agent-gateway': { ai: true } },
        ...(mode === 'blindroll' ? { blind: true } : {}),
      }),
      f.ctx.callOptions,
    );
    expect(f.ctx.snapshot).not.toHaveBeenCalled();
    expect(f.ctx.created).toHaveBeenCalledWith('ChatMessage.new');
  },
);
it('bounds unsuccessful rolls without normalization, snapshot or chat', async () => {
  const f = setup('RollTable', { tableUuid: 'RollTable.r' });
  f.child('a', { name: 'a', description: 'a', type: 'text', range: [5, 6], drawn: false });
  expect(await tableRollHandler(f.ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(f.evaluate).toHaveBeenCalledTimes(100);
  expect(f.ctx.snapshot).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
it.each(['missing', 'exhausted', 'nested'])(
  'refuses %s table state without mutation',
  async (mode) => {
    const f = setup('RollTable', { tableUuid: 'RollTable.r' });
    f.child('a', {
      name: 'a',
      description: 'a',
      type: mode === 'nested' ? 'document' : 'text',
      documentUuid: 'RollTable.other',
      range: [1, 3],
      drawn: mode === 'exhausted',
    });
    if (mode === 'missing') f.root._source.formula = '';
    expect(await tableRollHandler(f.ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(f.ctx.snapshot).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  },
);
it.each(['play', 'stop', 'next', 'set_volume'])(
  'audits playlist %s with statless sounds',
  async (action) => {
    const f = setup('Playlist', {
      playlistUuid: 'Playlist.r',
      action,
      ...(action === 'set_volume' ? { volume: 0.4 } : {}),
    });
    f.child('a', { playing: true, pausedTime: 4, volume: 1 });
    f.child('b', { playing: false, pausedTime: null, volume: 1 });
    f.root.playing = true;
    f.root.playbackOrder = ['a', 'b'];
    f.root.update = vi.fn(async (data: any, opts: any) => {
      expect(opts.agentGateway.callId).toBe('call');
      for (const c of data.sounds ?? [])
        Object.assign(
          f.rows.find((r) => r.id === c._id),
          c,
        );
      f.root.playing = f.rows.some((r) => r.playing);
      return f.root;
    });
    expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
    expect(f.ctx.snapshot).toHaveBeenCalledWith('Playlist.r');
    if (action === 'stop') expect(f.rows[0].pausedTime).toBe(4);
    if (action === 'next') expect(f.rows[1].playing).toBe(true);
    if (action === 'set_volume') expect(f.rows.every((r) => r.volume === 0.4)).toBe(true);
  },
);
it('refuses sound source drift at the same parent timestamp', async () => {
  const f = setup('Playlist', { playlistUuid: 'Playlist.r', action: 'stop' });
  const s = f.child('a', { playing: true, pausedTime: null, volume: 1 });
  f.root.update = vi.fn();
  f.ctx.snapshot.mockImplementation(async () => {
    s.volume = 0.5;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.root.update).not.toHaveBeenCalled();
});
it('bounded source rejects getters without invoking them', () => {
  const getter = vi.fn();
  const source = Object.defineProperty({ _id: 'r' }, 'value', { enumerable: true, get: getter });
  expect(() => ambienceSource({ id: 'r', toObject: () => source })).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
it.each(['cancelled', 'partial'])('refuses %s drawn-state update without chat', async (mode) => {
  const f = setup('RollTable', { tableUuid: 'RollTable.r' });
  f.child('a', { name: 'a', description: 'a', type: 'text', range: [1, 3], drawn: false });
  f.root.updateEmbeddedDocuments = vi.fn(async () =>
    mode === 'cancelled' ? undefined : [f.rows[0]],
  );
  await expect(tableRollHandler(f.ctx)).rejects.toThrow('did not persist');
  expect(f.create).not.toHaveBeenCalled();
});
it('detects a legacy compendium nested table through native UUID metadata', async () => {
  const f = setup('RollTable', { tableUuid: 'RollTable.r' });
  f.child('a', {
    name: 'a',
    description: 'a',
    type: 'document',
    documentUuid: 'Compendium.test.tables.entry',
    range: [1, 3],
    drawn: false,
  });
  expect(await tableRollHandler(f.ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(f.ctx.snapshot).not.toHaveBeenCalled();
});
it('same-track next preserves forced synchronization and audit metadata', async () => {
  const f = setup('Playlist', { playlistUuid: 'Playlist.r', action: 'next' });
  f.child('a', { playing: true, pausedTime: 4, volume: 1 });
  f.root.playing = true;
  f.root.playbackOrder = ['a'];
  f.root.update = vi.fn(async (data: any, options: any) => {
    expect(options).toEqual({ diff: false, render: false, forceSync: true, ...f.ctx.callOptions });
    Object.assign(f.rows[0], data.sounds[0]);
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
});
it('disabled play does not start sounds', async () => {
  const f = setup('Playlist', { playlistUuid: 'Playlist.r', action: 'play' });
  f.child('a', { playing: false, pausedTime: 4, volume: 1 });
  f.root.mode = -1;
  f.root.playing = false;
  f.root.update = vi.fn(async (data: any) => {
    expect(data).toEqual({ playing: false });
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
});
it('demotion during native roll prevents snapshots and writes', async () => {
  const f = setup('RollTable', { tableUuid: 'RollTable.r' });
  f.child('a', { name: 'a', description: 'a', type: 'text', range: [1, 3], drawn: false });
  f.evaluate.mockImplementation(async () => {
    f.user.isGM = false;
    return { total: 2, terms: [] };
  });
  expect(await tableRollHandler(f.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.ctx.snapshot).not.toHaveBeenCalled();
  expect(f.create).not.toHaveBeenCalled();
});
it.each([0, 1, 2])('native mode %s selected play stops only required sounds', async (mode) => {
  const f = setup('Playlist', {
    playlistUuid: 'Playlist.r',
    action: 'play',
    soundUuid: 'Playlist.r.PlaylistSound.b',
  });
  f.root.mode = mode;
  f.child('a', { playing: true, pausedTime: 4, volume: 1 });
  f.child('b', { playing: false, pausedTime: 2, volume: 1 });
  f.root.playing = true;
  f.root.update = vi.fn(async (data: any) => {
    for (const c of data.sounds)
      Object.assign(
        f.rows.find((r) => r.id === c._id),
        c,
      );
    f.root.playing = f.rows.some((r) => r.playing);
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
  expect(f.rows[1].playing).toBe(true);
  expect(f.rows[1].pausedTime).toBe(2);
  expect(f.rows[0].playing).toBe(mode === 2);
  expect(f.rows[0].pausedTime).toBe(mode === 2 ? 4 : null);
});
it.each([1, 2])('native mode %s whole play follows order or plays simultaneously', async (mode) => {
  const f = setup('Playlist', { playlistUuid: 'Playlist.r', action: 'play' });
  f.root.mode = mode;
  f.child('a', { playing: false, pausedTime: null, volume: 1 });
  f.child('b', { playing: false, pausedTime: null, volume: 1 });
  f.root.playing = false;
  f.root.playbackOrder = ['b', 'a'];
  f.root.update = vi.fn(async (data: any) => {
    for (const c of data.sounds)
      Object.assign(
        f.rows.find((r) => r.id === c._id),
        c,
      );
    f.root.playing = f.rows.some((r) => r.playing);
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
  expect(f.rows[1].playing).toBe(true);
  expect(f.rows[0].playing).toBe(mode === 2);
});
it('selected stop clears only its pause and leaves other playback', async () => {
  const f = setup('Playlist', {
    playlistUuid: 'Playlist.r',
    action: 'stop',
    soundUuid: 'Playlist.r.PlaylistSound.a',
  });
  f.child('a', { playing: true, pausedTime: 4, volume: 1 });
  f.child('b', { playing: true, pausedTime: 3, volume: 1 });
  f.root.playing = true;
  f.root.update = vi.fn(async (data: any) => {
    Object.assign(f.rows[0], data.sounds[0]);
    f.root.playing = data.playing;
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
  expect(f.rows[0].pausedTime).toBe(null);
  expect(f.rows[1]).toMatchObject({ playing: true, pausedTime: 3 });
});
it.each([true, false])('next wraps or clears stopped playlist playing=%s', async (playing) => {
  const f = setup('Playlist', {
    playlistUuid: 'Playlist.r',
    action: 'next',
    soundUuid: 'Playlist.r.PlaylistSound.b',
  });
  f.child('a', { playing: false, pausedTime: 4, volume: 1 });
  f.child('b', { playing, pausedTime: 3, volume: 1 });
  f.root.playing = playing;
  f.root.playbackOrder = ['a', 'b'];
  f.root.update = vi.fn(async (data: any) => {
    for (const c of data.sounds)
      Object.assign(
        f.rows.find((r) => r.id === c._id),
        c,
      );
    f.root.playing = f.rows.some((r) => r.playing);
    return f.root;
  });
  expect(await playlistControlHandler(f.ctx)).toMatchObject({ structured: { completed: true } });
  expect(f.rows[0].playing).toBe(playing);
  expect(f.rows.every((r) => r.pausedTime === null)).toBe(true);
});
it.each(['cancelled', 'noop'])('rejects %s playlist update', async (mode) => {
  const f = setup('Playlist', { playlistUuid: 'Playlist.r', action: 'set_volume', volume: 0.3 });
  f.child('a', { playing: false, pausedTime: null, volume: 1 });
  f.root.playing = false;
  f.root.update = vi.fn(async () => (mode === 'cancelled' ? undefined : f.root));
  await expect(playlistControlHandler(f.ctx)).rejects.toThrow('did not persist');
});
