import { describe, expect, it, vi } from 'vitest';
import { cleanupNativeFixtures, retainNativeAudit } from './native-lifecycle.js';
import { waitForLiveAudit } from '../player-writes/live-settlement.js';

describe('native fixture failure and cleanup lifecycle', () => {
  it('keeps original combat unviewed during deletion, then restores personal state', async () => {
    const original = { active: false, round: 7, turn: 2 };
    let viewed: typeof original | null = original;
    let deleted = false;
    await cleanupNativeFixtures({
      clearViewed: async () => {
        viewed = null;
      },
      deleteFixtures: async () => {
        // Genuine native Combat._onDelete activates whichever combat is viewed.
        if (viewed) viewed.active = true;
        deleted = true;
      },
      restoreViews: async () => {
        expect(deleted).toBe(true);
        viewed = original;
      },
    });
    expect(viewed).toBe(original);
    expect(original).toEqual({ active: false, round: 7, turn: 2 });
  });
  it('leaves an uncaptured original combat view untouched on preflight failure', async () => {
    const original = { active: false };
    let viewed: typeof original | null = original;
    const clearViewed = vi.fn(async () => {
      viewed = null;
    });
    await cleanupNativeFixtures({
      hasFixtureCombat: false,
      clearViewed,
      deleteFixtures: async () => {},
      restoreViews: async () => {}, // No browser baseline was captured before preflight failed.
    });
    expect(clearViewed).not.toHaveBeenCalled();
    expect(viewed).toBe(original);
  });
  it('restores views even if exact fixture deletion fails', async () => {
    const restoreViews = vi.fn(async () => {});
    await expect(
      cleanupNativeFixtures({
        clearViewed: async () => {},
        deleteFixtures: async () => {
          throw Error('delete refused');
        },
        restoreViews,
      }),
    ).rejects.toThrow('delete refused');
    expect(restoreViews).toHaveBeenCalledOnce();
  });
  it('retains a delayed unexpected-result audit even when another audit never persists', async () => {
    const expected = ['unexpected-INTERNAL', 'missing'];
    const retained: string[] = [];
    let now = 0;
    await expect(
      waitForLiveAudit(
        async () => {
          const rows = now ? [{ key: expected[0]!, uuid: 'JournalEntry.audit.Page.error' }] : [];
          retainNativeAudit(rows, expected, retained);
          return rows;
        },
        expected,
        {
          now: () => now,
          sleep: async () => {
            now += 100;
          },
          timeoutMs: 200,
        },
      ),
    ).rejects.toThrow('incomplete');
    expect(retained).toEqual(['JournalEntry.audit.Page.error']);
  });
});
