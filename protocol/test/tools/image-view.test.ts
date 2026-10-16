import { describe, expect, it } from 'vitest';
import { imageView } from '../../src/tools/image-view.js';
import { TOOLS } from '../../src/tools/index.js';

describe('image_view definition', () => {
  it('is a module-handled player read tool', () => {
    expect(imageView).toMatchObject({ minRole: 'player', category: 'read', handledBy: 'module' });
    expect(TOOLS).toContain(imageView);
  });
  it('sets mcpOutputSchema false and no other tool does', () => {
    expect(imageView.mcpOutputSchema).toBe(false);
    expect(TOOLS.filter((t) => t.mcpOutputSchema === false).map((t) => t.name)).toEqual([
      'image_view',
    ]);
  });
  it('keeps an empty strict output', () => {
    expect(imageView.output.safeParse({}).success).toBe(true);
    expect(imageView.output.safeParse({ a: 1 }).success).toBe(false);
  });
  it('accepts the five sources and rejects unknown ones and extra keys', () => {
    for (const source of ['actor_portrait', 'actor_token', 'token', 'scene_background', 'file'])
      expect(imageView.input.safeParse({ source }).success).toBe(true);
    expect(imageView.input.safeParse({ source: 'url' }).success).toBe(false);
    expect(imageView.input.safeParse({ source: 'file', x: 1 }).success).toBe(false);
  });
});
