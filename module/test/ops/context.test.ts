import { describe, expect, it } from 'vitest';
import {
  actionCategory,
  effectiveCategory,
  policyCategories,
  prepareContext,
} from '../../src/ops/context.js';
import { conditionsHandler } from '../../src/tools/conditions.js';
import { imageAssignHandler } from '../../src/tools/image-assign.js';
import type { OpContext } from '../../src/ops/types.js';
function context(change?: unknown): OpContext {
  return {
    user: { id: 'p', isGM: false },
    agent: { id: 'a', ownerUserId: 'p', headless: false },
    sessionId: 's',
    tool: 'conditions',
    args: { actorUuid: 'Actor.a', ...(change === undefined ? {} : { change }) },
  };
}
describe('trusted conditions preparation', () => {
  it('escalates only the canonical core conditions mutation before stages', () => {
    const ctx = context({ id: 'dead', active: true });
    prepareContext(ctx, 'read', true, conditionsHandler);
    expect(effectiveCategory(ctx, 'read')).toBe('write');
    expect(policyCategories(ctx, 'read')).toEqual(['read', 'write']);
    expect(() => ctx.escalate!('read')).toThrow();
    expect(() => ctx.escalate!('write')).toThrow();
    expect(actionCategory('conditions', ctx.args, 'read', false)).toBe('read');
    expect(actionCategory('pack-conditions', ctx.args, 'read', true)).toBe('read');
  });
  it('reads remain read and forged or inconsistent preparation fails closed', () => {
    const ctx = context();
    prepareContext(ctx, 'read', true, conditionsHandler);
    expect(effectiveCategory(ctx, 'read')).toBe('read');
    expect(() =>
      prepareContext(context({ id: 'dead' }), 'read', false, conditionsHandler),
    ).toThrow();
    expect(() =>
      prepareContext(context({ id: 'dead' }), 'read', true, () => ({ text: '', structured: {} })),
    ).toThrow();
  });
});
describe('image_assign preparation', () => {
  const ia = (args: unknown): OpContext => ({ ...context(), tool: 'image_assign', args });
  it('classifies set as write in actionCategory, list as read, and not for packs', () => {
    expect(actionCategory('image_assign', { action: 'set' }, 'read')).toBe('write');
    expect(actionCategory('image_assign', { action: 'list' }, 'read')).toBe('read');
    expect(actionCategory('image_assign', { action: 'set' }, 'read', false)).toBe('read');
  });
  it('escalates set before stages and leaves list as read; a pack cannot prepare', () => {
    const set = ia({ action: 'set' });
    prepareContext(set, 'read', true, imageAssignHandler);
    expect(effectiveCategory(set, 'read')).toBe('write');
    const list = ia({ action: 'list' });
    prepareContext(list, 'read', true, imageAssignHandler);
    expect(effectiveCategory(list, 'read')).toBe('read');
    expect(() =>
      prepareContext(ia({ action: 'set' }), 'read', false, imageAssignHandler),
    ).toThrow();
  });
});
