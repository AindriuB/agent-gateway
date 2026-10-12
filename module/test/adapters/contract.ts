import { describe, expect, it } from 'vitest';
import {
  actorSummaryOutput,
  actionsListOutput,
  inventoryOutput,
  conditionsOutput,
} from '@agent-gateway/protocol';
import type { SystemAdapter } from '../../src/adapters/types.js';
/** Shared read contract. Concrete adapters supply native-shaped fixture Actors. */
export function adapterContract(
  adapter: SystemAdapter,
  fixture: { actor: unknown; actorUuid: string; systemId: string },
) {
  describe(`adapter contract: ${adapter.systemId}`, () => {
    const identity = { actorUuid: fixture.actorUuid, systemId: fixture.systemId };
    it('returns the bounded summary contract', async () =>
      expect(
        actorSummaryOutput.safeParse({
          ...(await adapter.actorSummary(fixture.actor)),
          ...identity,
        }).success,
      ).toBe(true));
    it('returns the bounded actions contract', async () =>
      expect(
        actionsListOutput.safeParse({ ...(await adapter.listActions(fixture.actor)), ...identity })
          .success,
      ).toBe(true));
    it('returns the bounded inventory contract', async () =>
      expect(
        inventoryOutput.safeParse({
          ...(await adapter.inventorySemantics(fixture.actor)),
          ...identity,
        }).success,
      ).toBe(true));
    it('returns the bounded conditions contract', async () =>
      expect(
        conditionsOutput.safeParse({ ...(await adapter.conditions(fixture.actor)), ...identity })
          .success,
      ).toBe(true));
  });
}
