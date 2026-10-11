import { expect, it } from 'vitest';
import {
  task24Calls,
  task24FixtureData,
  freshCallAudit,
  capturedCallAudit,
} from './native-plan.js';
const ids = {
  actor: 'Actor.a',
  scene: 'Scene.s',
  combat: 'Combat.c',
  tokens: ['Scene.s.Token.t', 'Scene.s.Token.u'] as [string, string],
  combatants: ['Combat.c.Combatant.a', 'Combat.c.Combatant.b'] as [string, string],
  level: 'l',
};
it('enumerates sixteen requests with thirteen successes, two handler refusals and one human denial', () => {
  const calls = task24Calls(ids);
  expect(calls).toHaveLength(16);
  expect(calls.filter((c) => c.expected === 'ok')).toHaveLength(13);
  expect(calls.filter((c) => c.audit)).toHaveLength(15);
  expect(calls[12]).toMatchObject({ expected: 'DENIED', audit: false });
  expect(calls[13]!.args).toEqual(calls[12]!.args);
});
it('uses only fresh disposable data and two levels with no media', () => {
  const data = task24FixtureData('abcdef123456');
  expect(data.actor.items).toEqual([]);
  expect(data.actor.effects).toEqual([]);
  expect(data.scene.levels).toHaveLength(2);
  expect(data.scene.active).toBe(false);
  expect(data.scene.playlist).toBe(null);
  expect(data.scene.environment.darknessLock).toBe(false);
  expect(() => task24FixtureData('bad')).toThrow();
});
it('requires each repeated-argument call to have a fresh exact correlated audit identity', () => {
  const call = task24Calls(ids)[14]!;
  const identity = { userId: 'gm', agentId: 'agent' };
  const old = {
    uuid: 'old',
    ...identity,
    tool: call.tool,
    args: JSON.stringify(call.args),
    status: 'error',
  };
  expect(() => freshCallAudit([old], ['old'], identity, call)).toThrow();
  const current = { ...old, uuid: 'new', status: 'ok' };
  expect(freshCallAudit([old, current], ['old'], identity, call).uuid).toBe('new');
  expect(() => freshCallAudit([{ ...current, agentId: 'foreign' }], [], identity, call)).toThrow();
  expect(() =>
    freshCallAudit([current, { ...current, uuid: 'extra' }], [], identity, call),
  ).toThrow();
});

it('v13 retains sixteen requests and fifteen audits with explicit unsupported level and no level fixtures', () => {
  const calls = task24Calls(ids, 13);
  expect(calls).toHaveLength(16);
  expect(calls.filter((c) => c.expected === 'ok')).toHaveLength(12);
  expect(
    calls.filter((c) => c.expected === 'INVALID_ARGS' || c.expected === 'FORBIDDEN'),
  ).toHaveLength(3);
  expect(calls.filter((c) => c.audit)).toHaveLength(15);
  expect(task24FixtureData('abcdef123456', 13).scene).not.toHaveProperty('levels');
});

it('drains captured failed and successful identical calls by exact immutable identities', () => {
  const calls = task24Calls(ids),
    identity = { userId: 'gm', agentId: 'agent' };
  const failed = {
    uuid: 'failed',
    entryId: 'entry-failed',
    ...identity,
    tool: calls[8]!.tool,
    args: JSON.stringify(calls[8]!.args),
    status: 'error',
  };
  const success = { ...failed, uuid: 'success', entryId: 'entry-success', status: 'ok' };
  const rows = [failed, success];
  expect(() => freshCallAudit(rows, [], identity, calls[8]!, false)).toThrow();
  expect(capturedCallAudit(rows, [], identity, calls[8]!, failed)).toBe(failed);
  expect(capturedCallAudit(rows, ['failed'], identity, calls[14]!, success)).toBe(success);
  for (const changed of [
    { ...failed, entryId: 'replaced' },
    { ...failed, agentId: 'foreign' },
    { ...failed, status: 'ok' },
  ])
    expect(() => capturedCallAudit([changed, success], [], identity, calls[8]!, failed)).toThrow();
  expect(() => capturedCallAudit([success], [], identity, calls[8]!, failed)).toThrow();
  expect(() => capturedCallAudit([failed, failed], [], identity, calls[8]!, failed)).toThrow();
});

import { task24ProofPins } from './native-plan.js';
it('pins reviewed runtime defaults and validates configurable source/build identities', () => {
  expect(task24ProofPins().source).toHaveLength(40);
  expect(task24ProofPins().bundle).toHaveLength(64);
  expect(task24ProofPins('a'.repeat(40), 'b'.repeat(64))).toEqual({
    source: 'a'.repeat(40),
    bundle: 'b'.repeat(64),
  });
  for (const [source, bundle] of [
    ['', 'b'.repeat(64)],
    ['main', 'b'.repeat(64)],
    ['a'.repeat(40), 'latest'],
    ['A'.repeat(40), 'b'.repeat(64)],
  ])
    expect(() => task24ProofPins(source, bundle)).toThrow();
});
