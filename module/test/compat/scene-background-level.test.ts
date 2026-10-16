/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { sceneBackgroundLevel } from '../../src/compat/index.js';

const level = (id: string) => ({ id });
const levels = (...list: any[]) =>
  Object.assign(new Map(list.map((l) => [l.id, l])), { contents: list });
const gen = (generation: number) => {
  (globalThis as any).game = { release: { generation } };
};
afterEach(() => {
  delete (globalThis as any).game;
});

describe('sceneBackgroundLevel', () => {
  it('v14 returns initialLevel even when it is not the first Level', () => {
    gen(14);
    const first = level('first');
    const init = level('init');
    expect(sceneBackgroundLevel({ initialLevel: init, levels: levels(first, init) })).toBe(init);
  });
  it('v14 without initialLevel prefers defaultLevel0000, then the first level', () => {
    gen(14);
    const first = level('first');
    const def = level('defaultLevel0000');
    expect(sceneBackgroundLevel({ initialLevel: null, levels: levels(first, def) })).toBe(def);
    expect(sceneBackgroundLevel({ levels: levels(first, level('x')) })).toBe(first);
  });
  it('v14 with no level returns null', () => {
    gen(14);
    expect(sceneBackgroundLevel({ levels: levels() })).toBeNull();
  });
  it('v13 returns the Scene itself', () => {
    gen(13);
    const scene = { background: { src: 'a.png' }, levels: levels(level('l')) };
    expect(sceneBackgroundLevel(scene)).toBe(scene);
  });
});
