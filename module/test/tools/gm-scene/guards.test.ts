/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actionFields, check, footprint, notInCombat, version } from '../../../src/tools/_scene.js';
import {
  effectiveCategory,
  policyCategories,
  prepareContext,
  withPreparation,
} from '../../../src/ops/context.js';
import type { OpContext, OpHandler } from '../../../src/ops/types.js';
afterEach(() => vi.unstubAllGlobals());
const context = () =>
  ({ tool: 'token_manage', args: { action: 'remove' }, user: { id: 'gm' } }) as OpContext;
describe('immutable core preparation', () => {
  it('binds destructive once without changing base category', () => {
    const c = context();
    prepareContext(
      c,
      'write',
      true,
      withPreparation(async () => ({})),
    );
    expect(effectiveCategory(c, 'write')).toBe('destructive');
    expect(policyCategories(c, 'write')).toEqual(['write', 'destructive']);
    expect(() => c.escalate!('destructive')).toThrow();
  });
  it.each(['read', 'unknown'])('rejects invalid escalation %s', (category) => {
    const h = (async () => ({})) as OpHandler;
    h.prepare = (c) => c.escalate!(category as any);
    expect(() => prepareContext(context(), 'write', true, h)).toThrow();
  });
  it('rejects pack preparation', () => {
    expect(() =>
      prepareContext(
        context(),
        'write',
        false,
        withPreparation(async () => ({})),
      ),
    ).toThrow();
  });
  it('rejects asynchronous preparation', () => {
    const h = (async () => ({})) as OpHandler;
    h.prepare = (() => Promise.resolve()) as any;
    expect(() => prepareContext(context(), 'write', true, h)).toThrow();
  });
});
it('rejects wrong action fields', () => {
  expect(() =>
    actionFields({ action: 'show', tokenUuid: 't', hidden: true }, ['tokenUuid']),
  ).toThrow();
});
it('uses signed native scene rectangle and actual footprint', () => {
  const scene = { dimensions: { sceneRect: { x: -200, y: -100, width: 400, height: 300 } } };
  const token = { getSize: () => ({ width: 70, height: 90 }) };
  expect(() => footprint(scene, token, -200, -100)).not.toThrow();
  expect(() => footprint(scene, token, 150, 0)).toThrow();
});
it('requires actual current GM and canonical identity', () => {
  const gm = { id: 'gm', isGM: true };
  const scene: any = {
    id: 's',
    uuid: 'Scene.s',
    documentName: 'Scene',
    testUserPermission: () => true,
  };
  vi.stubGlobal('game', { user: gm, users: { get: () => gm }, scenes: { get: () => scene } });
  expect(check(context(), scene, 'Scene')).toBe(scene);
  expect(() => check(context(), { ...scene }, 'Scene')).toThrow();
  gm.isGM = false;
  expect(() => check(context(), scene, 'Scene')).toThrow();
});
it('refuses token removal while any canonical combatant references it', () => {
  const token: any = { id: 't', parent: { id: 's' } };
  const combat: any = { id: 'c', uuid: 'Combat.c', documentName: 'Combat', scene: null };
  const row: any = {
    id: 'r',
    uuid: 'Combat.c.Combatant.r',
    documentName: 'Combatant',
    parent: combat,
    tokenId: 't',
    sceneId: 's',
  };
  combat.combatants = { contents: [row], get: () => row };
  vi.stubGlobal('game', { combats: { contents: [combat], get: () => combat } });
  expect(() => notInCombat(token)).toThrow('every encounter');
});

it.each([undefined, NaN, Infinity, -1])(
  'rejects missing/invalid native version %s',
  (modifiedTime) => {
    expect(() => version({ _stats: { modifiedTime } })).toThrow();
  },
);
