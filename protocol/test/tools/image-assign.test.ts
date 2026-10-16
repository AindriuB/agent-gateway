import { describe, expect, it } from 'vitest';
import {
  checkToolDefinition,
  imageAssign,
  toJsonSchema,
  toolsForRole,
} from '../../src/tools/index.js';

describe('image_assign schema', () => {
  it('is a player-visible module read tool within conservative schema rules', () => {
    expect(imageAssign).toMatchObject({ minRole: 'player', category: 'read', handledBy: 'module' });
    expect(toolsForRole(false).map((t) => t.name)).toContain('image_assign');
    expect(
      checkToolDefinition(
        {
          ...toJsonSchema(imageAssign),
          name: imageAssign.name,
          description: imageAssign.description,
          minRole: imageAssign.minRole,
          category: imageAssign.category,
          handledBy: imageAssign.handledBy,
        },
        'core',
      ),
    ).toEqual([]);
  });
  it('accepts list and set, bounds limit, and has no url or source argument', () => {
    const ok = (v: unknown) => imageAssign.input.safeParse(v).success;
    expect(ok({ action: 'list' })).toBe(true);
    expect(ok({ action: 'list', dir: '', limit: 200 })).toBe(true);
    expect(ok({ action: 'list', limit: 201 })).toBe(false);
    expect(ok({ action: 'list', limit: 0 })).toBe(false);
    expect(ok({ action: 'set', path: 'a.png', target: 'tile', uuid: 'Scene.s.Tile.t' })).toBe(true);
    expect(ok({ action: 'set', path: 'a.png', target: 'bogus', uuid: 'x' })).toBe(false);
    expect(ok({ action: 'list', url: 'https://x' })).toBe(false);
    expect(ok({ action: 'list', source: 'public' })).toBe(false);
  });
});
