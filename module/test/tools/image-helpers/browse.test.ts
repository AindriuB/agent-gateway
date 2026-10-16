/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browseImages, resolveFilePicker } from '../../../src/tools/_image.js';

afterEach(() => vi.unstubAllGlobals());
const install = (listing: any = { dirs: [], files: [] }) => {
  const browse = vi.fn(async () => listing);
  vi.stubGlobal('foundry', { applications: { apps: { FilePicker: { implementation: { browse } } } } });
  return browse;
};
const gm = { isGM: true, can: () => true };
const player = { isGM: false, can: () => false };
const trusted = { isGM: false, can: (p: string) => p === 'FILES_BROWSE' };

describe('browseImages', () => {
  it('refuses a player without FILES_BROWSE and never browses', async () => {
    const browse = install();
    await expect(browseImages(player, 'a', 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(browse).not.toHaveBeenCalled();
  });
  it('allows a GM and a user with FILES_BROWSE; filters to images and dirs', async () => {
    const browse = install({ dirs: ['a/d'], files: ['a/x.png', 'a/y.svg', 'a/z.JPG'] });
    for (const u of [gm, trusted]) {
      const r = await browseImages(u, 'a', 10);
      expect(r).toEqual({ dir: 'a', dirs: ['a/d'], files: ['a/x.png', 'a/z.JPG'], truncated: false });
    }
    expect(browse).toHaveBeenCalledWith('data', 'a');
  });
  it('rejects traversal before the stub', async () => {
    const browse = install();
    await expect(browseImages(gm, '../a', 10)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(browse).not.toHaveBeenCalled();
  });
  it('browses the Data root for empty and omitted dir', async () => {
    const browse = install();
    await browseImages(gm, '', 10);
    await browseImages(gm, undefined, 10);
    expect(browse).toHaveBeenNthCalledWith(1, 'data', '');
    expect(browse).toHaveBeenNthCalledWith(2, 'data', '');
  });
  it('rejects / before the stub', async () => {
    const browse = install();
    await expect(browseImages(gm, '/', 10)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    expect(browse).not.toHaveBeenCalled();
  });
  it('truncates at limit and at the hard maximum of 200', async () => {
    const files = Array.from({ length: 300 }, (_, i) => `f${i}.png`);
    install({ dirs: [], files });
    const r = await browseImages(gm, '', 3);
    expect(r.files).toEqual(['f0.png', 'f1.png', 'f2.png']);
    expect(r.truncated).toBe(true);
    const big = await browseImages(gm, '', 1000);
    expect(big.files).toHaveLength(200);
    expect(big.truncated).toBe(true);
  });
  it('resolves the FilePicker or fails closed', () => {
    install();
    expect(typeof resolveFilePicker().browse).toBe('function');
    vi.stubGlobal('foundry', {});
    expect(() => resolveFilePicker()).toThrow();
  });
});
