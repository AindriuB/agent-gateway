import { describe, expect, it, vi } from 'vitest';
import { genericAdapter } from '../../../src/adapters/generic/index.js';
import { selectAdapter } from '../../../src/adapters/index.js';
import {
  AdapterUnsupportedError,
  type AdapterExecutionContext,
} from '../../../src/adapters/types.js';
import { adapterContract } from '../contract.js';
const actor = {
  name: 'Hero',
  img: 'icons/hero.webp',
  type: 'npc',
  system: { secret: 'private' },
  flags: { other: 'private' },
  update: vi.fn(),
};
adapterContract(genericAdapter, { actor, actorUuid: 'Actor.a', systemId: 'unknown' });
describe('generic fallback', () => {
  it('uses internal registry fallback without system-data guesses', async () => {
    expect(selectAdapter('unknown')).toBe(genericAdapter);
    expect(await genericAdapter.actorSummary(actor)).toEqual({
      name: 'Hero',
      img: 'icons/hero.webp',
      type: 'npc',
      attributes: [],
    });
    expect(await genericAdapter.listActions(actor)).toEqual({ supported: false, actions: [] });
    expect(await genericAdapter.inventorySemantics(actor)).toEqual({
      supported: false,
      items: [],
      totals: [],
    });
    expect(await genericAdapter.conditions(actor)).toEqual({ supported: false, conditions: [] });
  });
  it('unsupported actions and condition changes never invoke native mutators', () => {
    expect(() =>
      genericAdapter.performAction(actor, 'attack', {}, {} as AdapterExecutionContext),
    ).toThrow(AdapterUnsupportedError);
    expect(() => genericAdapter.conditions(actor, { id: 'dead', active: true })).toThrow(
      AdapterUnsupportedError,
    );
    expect(actor.update).not.toHaveBeenCalled();
  });
});
