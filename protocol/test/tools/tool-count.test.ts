import { describe, expect, it } from 'vitest';
import { TOOLS, toolsForRole } from '../../src/tools/index.js';

// Spec section 4 (cross-vendor rules): keep tools per session small,
// about 18 player and about 28 GM. These are the hard ceilings.
// Raised by owner decision on 2026-10-16 (24 -> 26 player, 36 -> 38 GM) so the
// image tools (image_upload, image_assign, image_view) fit.
export const MAX_PLAYER_TOOLS = 26;
export const MAX_GM_TOOLS = 38;

describe('tool registry', () => {
  it('stays within per-role tool counts', () => {
    expect(toolsForRole(false).length).toBeLessThanOrEqual(MAX_PLAYER_TOOLS);
    expect(toolsForRole(true).length).toBeLessThanOrEqual(MAX_GM_TOOLS);
  });

  it('has no duplicate tool names', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('GM sees every tool; players only player tools', () => {
    expect(toolsForRole(true)).toHaveLength(TOOLS.length);
    expect(toolsForRole(false).every((t) => t.minRole === 'player')).toBe(true);
  });
});
