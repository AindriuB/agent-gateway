import { expect, it, vi } from 'vitest';
import { assertTask24Terminal } from './native-lifecycle.js';
import { freshCallAudit } from './native-plan.js';
it('refuses cleanup after settled-but-unproven execution, missing queue or foreign decision', () => {
  const record = { terminal: true, approvalId: 'own' };
  expect(() => assertTask24Terminal([record], undefined)).toThrow();
  expect(() => assertTask24Terminal([record], [{ id: 'foreign', status: 'denied' }])).toThrow();
  expect(() =>
    assertTask24Terminal(
      [{ ...record, terminal: false }],
      [{ id: 'own', status: 'approved', result: { text: 'ok' } }],
    ),
  ).toThrow();
  expect(() => assertTask24Terminal([record], [{ id: 'own', status: 'approved' }])).toThrow();
  expect(() =>
    assertTask24Terminal([record], [{ id: 'own', status: 'approved', result: { text: 'ok' } }]),
  ).not.toThrow();
});
it('retains an exact late error audit for cleanup while acceptance still refuses unexpected failure', () => {
  const call = {
    tool: 'token_manage',
    args: { action: 'place' },
    expected: 'ok' as const,
    audit: true,
  };
  const identity = { userId: 'gm', agentId: 'agent' };
  const row = {
    uuid: 'new',
    ...identity,
    tool: call.tool,
    args: JSON.stringify(call.args),
    status: 'error',
  };
  expect(() => freshCallAudit([], [], identity, call, false)).toThrow();
  expect(() => freshCallAudit([row], [], identity, call)).toThrow();
  expect(freshCallAudit([row], [], identity, call, false)).toBe(row);
  expect(() => freshCallAudit([{ ...row, agentId: 'other' }], [], identity, call, false)).toThrow();
});

import {
  assertTask24Decision,
  assertTask24Activation,
  assertTask24Bundle,
} from './native-lifecycle.js';
it('never substitutes expiry or another approver for an explicit human denial', () => {
  expect(() =>
    assertTask24Decision({ status: 'expired', resolvedBy: 'dev-gm' }, 'dev-gm', true),
  ).toThrow();
  expect(() =>
    assertTask24Decision({ status: 'denied', resolvedBy: 'other' }, 'dev-gm', true),
  ).toThrow();
  expect(() =>
    assertTask24Decision({ status: 'denied', resolvedBy: 'dev-gm' }, 'dev-gm', true),
  ).not.toThrow();
});
it('refuses restoring a previous Scene over external activation or ordinary data changes', () => {
  const saved = [
    { uuid: 'Scene.old', source: { active: false, name: 'old', _stats: { modifiedTime: 10 } } },
  ];
  const proof = {
    fixture: 'Scene.fixture',
    current: ['Scene.fixture'],
    saved,
    currentSources: saved,
  };
  expect(() => assertTask24Activation(proof)).not.toThrow();
  expect(() => assertTask24Activation({ ...proof, current: ['Scene.other'] })).toThrow();
  expect(() =>
    assertTask24Activation({
      ...proof,
      currentSources: [{ uuid: 'Scene.old', source: { active: false, name: 'changed' } }],
    }),
  ).toThrow();
});
it('refuses source drift before any native activity', () => {
  expect(() => assertTask24Bundle('a'.repeat(64), 'b'.repeat(64))).toThrow();
  expect(() => assertTask24Bundle('a'.repeat(64), 'a'.repeat(64))).not.toThrow();
});

it('refuses a Session approval before any subsequent planned request', () => {
  expect(() =>
    assertTask24Decision(
      { status: 'approved', resolvedBy: 'dev-gm', scope: 'session' },
      'dev-gm',
      false,
    ),
  ).toThrow();
  expect(() =>
    assertTask24Decision(
      { status: 'approved', resolvedBy: 'dev-gm', scope: 'once' },
      'dev-gm',
      false,
    ),
  ).not.toThrow();
});

import { assertTask24Principal } from './native-lifecycle.js';
it('requires exact authenticated live world/user/agent and all native announcements before fixtures', () => {
  const expected = { worldId: 'world', userId: 'gm-id', agentId: 'agent' };
  const conn = { ...expected, closed: false, info: { isGM: true } };
  const tools = ['token_manage', 'combat_manage', 'scene_control'].map((name) => ({ name }));
  let creates = 0;
  const create = () => {
    assertTask24Principal(expected, conn, tools);
    creates++;
  };
  create();
  expect(creates).toBe(1);
  for (const bad of [
    undefined,
    { ...conn, closed: true },
    { ...conn, worldId: 'foreign' },
    { ...conn, userId: 'gm-name' },
    { ...conn, agentId: 'foreign' },
    { ...conn, info: { isGM: false } },
  ])
    expect(() => {
      assertTask24Principal(expected, bad, tools);
      creates++;
    }).toThrow();
  expect(() => assertTask24Principal(expected, conn, undefined)).toThrow();
  expect(() => assertTask24Principal(expected, conn, tools.slice(0, 2))).toThrow();
  expect(creates).toBe(1);
});

import { task24RemoveFixtures } from './native-lifecycle.js';
it('stops exact cleanup after demotion during an awaited deletion, before the next write', async () => {
  const user = { id: 'gm', isGM: true, active: true };
  const first = {
    uuid: 'Actor.first',
    flags: { world: { task24: 'nonce' } },
    delete: vi.fn(async () => {}),
  };
  const second = {
    uuid: 'Actor.second',
    flags: { world: { task24: 'nonce' } },
    delete: vi.fn(async () => {
      user.isGM = false;
    }),
  };
  const game = {
    user,
    time: { worldTime: 0 },
    users: { get: () => user, activeGM: user, contents: [user] },
    scenes: { contents: [] },
  };
  vi.stubGlobal('game', game);
  vi.stubGlobal('ui', { combat: { viewed: null } });
  vi.stubGlobal('fromUuid', async (uuid: string) => (uuid === first.uuid ? first : second));
  try {
    await expect(
      task24RemoveFixtures({
        roots: [first.uuid, second.uuid],
        run: 'nonce',
        baseline: {
          gm: { id: 'gm' },
          worldTime: 0,
          roots: [],
          activeScenes: [],
          view: { sceneId: null, targets: [] },
        },
      }),
    ).rejects.toThrow('Cleanup GM authority');
    expect(second.delete).toHaveBeenCalledOnce();
    expect(first.delete).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it('does not change targets after authority changes during awaited local view restoration', async () => {
  const user = { id: 'gm', isGM: true, active: true };
  const old = {
    view: vi.fn(async () => {
      user.isGM = false;
    }),
  };
  const setTargets = vi.fn();
  vi.stubGlobal('game', {
    user,
    time: { worldTime: 0 },
    users: { get: () => user, activeGM: user, contents: [user] },
    scenes: { contents: [], get: () => old },
  });
  vi.stubGlobal('ui', { combat: { viewed: null } });
  vi.stubGlobal('canvas', { tokens: { setTargets } });
  try {
    await expect(
      task24RemoveFixtures({
        roots: [],
        run: 'nonce',
        baseline: {
          gm: { id: 'gm' },
          worldTime: 0,
          roots: [],
          activeScenes: [],
          view: { sceneId: 'old', targets: [] },
        },
      }),
    ).rejects.toThrow('Cleanup GM authority');
    expect(old.view).toHaveBeenCalledOnce();
    expect(setTargets).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
