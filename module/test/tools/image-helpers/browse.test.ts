/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { browseImages, resolveFilePicker } from '../../../src/tools/_image.js';

afterEach(() => vi.unstubAllGlobals());
const install = (listing: any = { dirs: [], files: [] }) => {
  const browse = vi.fn(async () => listing);
  vi.stubGlobal('foundry', {
    applications: { apps: { FilePicker: { implementation: { browse } } } },
  });
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
      expect(r).toEqual({
        dir: 'a',
        dirs: [{ path: 'a/d', name: 'd' }],
        files: [
          { path: 'a/x.png', name: 'x.png' },
          { path: 'a/z.JPG', name: 'z.JPG' },
        ],
        truncated: false,
      });
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
    expect(r.files.map((f) => f.path)).toEqual(['f0.png', 'f1.png', 'f2.png']);
    expect(r.truncated).toBe(true);
    const big = await browseImages(gm, '', 1000);
    expect(big.files).toHaveLength(200);
    expect(big.truncated).toBe(true);
  });
  it('lists a file in a Token Art folder from encoded entries', async () => {
    const browse = install({
      dirs: ['Token%20Art/Sub%20%C3%A9'],
      files: ['Token%20Art/Goblin%201.png', 'Token%20Art/%40types.svg', 'Token%20Art/a(1).png'],
    });
    const r = await browseImages(gm, 'Token Art', 10);
    expect(browse).toHaveBeenCalledWith('data', 'Token%20Art');
    expect(r.dir).toBe('Token%20Art');
    expect(r.dirs).toEqual([{ path: 'Token%20Art/Sub%20%C3%A9', name: 'Sub é' }]);
    expect(r.files).toEqual([
      { path: 'Token%20Art/Goblin%201.png', name: 'Goblin 1.png' },
      { path: 'Token%20Art/a(1).png', name: 'a(1).png' },
    ]);
    await browseImages(gm, 'Token%20Art', 10);
    expect(browse).toHaveBeenLastCalledWith('data', 'Token%20Art');
  });
  it('drops invalid directory entries and never double-encodes', async () => {
    install({
      dirs: ['../secret', '/etc', 'https://x', 'ok%2520x', 'good'],
      files: ['%2520.png'],
    });
    const r = await browseImages(gm, '', 10);
    expect(r.dirs).toEqual([{ path: 'good', name: 'good' }]);
    expect(r.files).toEqual([]);
  });
  it('maps browse errors to WriteError', async () => {
    const browse = install();
    browse.mockRejectedValueOnce(new Error('Directory x does not exist'));
    await expect(browseImages(gm, 'x', 10)).rejects.toMatchObject({ code: 'INVALID_ARGS' });
    browse.mockRejectedValueOnce(new Error('You lack permission to browse'));
    await expect(browseImages(gm, 'x', 10)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('resolves the FilePicker or fails closed', () => {
    install();
    expect(typeof resolveFilePicker().browse).toBe('function');
    vi.stubGlobal('foundry', {});
    expect(() => resolveFilePicker()).toThrow();
  });
});
