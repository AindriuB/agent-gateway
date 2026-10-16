import { describe, expect, it } from 'vitest';
import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  decodeDataPath,
  isImagePath,
  normalizeDataDir,
  normalizeDataPath,
  sniffImage,
} from '../../src/index.js';

const bytes = (...n: number[]) => new Uint8Array(n);
const text = (s: string) => new TextEncoder().encode(s);

describe('constants', () => {
  it('are exact and exclude svg', () => {
    expect([...IMAGE_MIME_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect([...IMAGE_EXTENSIONS]).toEqual(['.png', '.jpg', '.jpeg', '.webp']);
    expect(JSON.stringify([IMAGE_MIME_TYPES, IMAGE_EXTENSIONS])).not.toMatch(/svg/i);
  });
});

describe('sniffImage', () => {
  it('detects png, jpeg, webp', () => {
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe('image/png');
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffImage(text('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('rejects others', () => {
    expect(sniffImage(text('<svg xmlns=""/>'))).toBeNull();
    expect(sniffImage(text('<?xml version="1.0"?>'))).toBeNull();
    expect(sniffImage(text('GIF89a....'))).toBeNull();
    expect(sniffImage(text('RIFF\0\0\0\0WAVEfmt '))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
    expect(sniffImage(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImage(text('RIFF\0\0\0\0WEB'))).toBeNull();
  });
});

describe('normalizeDataPath', () => {
  it('accepts a canonical path', () => {
    expect(normalizeDataPath('agent-gateway/uploads/u 1/a_b.png')).toEqual({
      ok: true,
      path: 'agent-gateway/uploads/u%201/a_b.png',
    });
  });
  const bad: Array<[string, string, string]> = [
    ['empty', '', 'EMPTY'],
    ['too long', 'a'.repeat(257), 'TOO_LONG'],
    ['too long once encoded', 'é'.repeat(200), 'TOO_LONG'],
    ['leading slash', '/a.png', 'ABSOLUTE'],
    ['drive letter', 'C:/a.png', 'ABSOLUTE'],
    ['https', 'https://x/a.png', 'SCHEME'],
    ['data', 'data:image/png;base64,AA', 'SCHEME'],
    ['file', 'file:///a.png', 'SCHEME'],
    ['backslash', 'a\\b.png', 'BACKSLASH'],
    ['NUL', 'a\u0000.png', 'CONTROL'],
    ['control', 'a\n.png', 'CONTROL'],
    ['dotdot', 'a/../b.png', 'DOT_SEGMENT'],
    ['leading dotdot', '../b.png', 'DOT_SEGMENT'],
    ['dot', 'a/./b.png', 'DOT_SEGMENT'],
    ['encoded dotdot', 'a/%2e%2e/b.png', 'DOT_SEGMENT'],
    ['bare encoded dotdot', '%2e%2e', 'DOT_SEGMENT'],
    ['encoded slash dotdot', 'a%2f..%2fb.png', 'BAD_CHARACTER'],
    ['dot-space segment', 'a/.. /b', 'DOT_SEGMENT'],
    ['space only', ' ', 'DOT_SEGMENT'],
    ['dots only', '...', 'DOT_SEGMENT'],
    ['encoded NUL', 'a%00.png', 'CONTROL'],
    ['encoded backslash', 'a%5cb.png', 'BACKSLASH'],
    ['double encoding', '%2520', 'PERCENT'],
    ['literal percent', '100%.png', 'BAD_ESCAPE'],
    ['encoded percent', 'a%25b.png', 'PERCENT'],
    ['malformed escape', '%E0%A4', 'BAD_ESCAPE'],
    ['empty segment', 'a//b.png', 'EMPTY_SEGMENT'],
    ['trailing slash', 'a/b/', 'EMPTY_SEGMENT'],
    ['odd char', 'a/b?.png', 'BAD_CHARACTER'],
    ['encoded odd char', 'a%3Fb.png', 'BAD_CHARACTER'],
  ];
  it.each(bad)('rejects %s', (_n, input, code) => {
    expect(normalizeDataPath(input)).toEqual({ ok: false, code });
  });
});

describe('normalizeDataPath encoding (Amendment 2)', () => {
  it('gives raw and encoded input the same canonical path', () => {
    const want = { ok: true, path: 'Token%20Art/Goblin%201.png' };
    expect(normalizeDataPath('Token Art/Goblin 1.png')).toEqual(want);
    expect(normalizeDataPath('Token%20Art/Goblin%201.png')).toEqual(want);
  });
  it('accepts encoded non-ASCII and NFC-normalizes NFD input', () => {
    const want = { ok: true, path: 'ag%20enc%20%C3%A9.png' };
    expect(normalizeDataPath('ag%20enc%20%C3%A9.png')).toEqual(want);
    expect(normalizeDataPath('ag enc e\u0301.png')).toEqual(want);
    expect(normalizeDataPath('ag enc \u00e9.png')).toEqual(want);
  });
  it('round-trips @types as %40types', () => {
    expect(normalizeDataPath('@types')).toEqual({ ok: true, path: '%40types' });
    expect(normalizeDataPath('%40types')).toEqual({ ok: true, path: '%40types' });
  });
  it('accepts a non-ASCII path whose canonical form is within 256', () => {
    expect(normalizeDataPath('é'.repeat(40)).ok).toBe(true);
  });
  it('decodeDataPath returns the display form', () => {
    expect(decodeDataPath('Token%20Art/%C3%A9.png')).toBe('Token Art/é.png');
    expect(decodeDataPath('%2520')).toBeNull();
  });
});

describe('normalizeDataDir', () => {
  it('maps empty and undefined to the root', () => {
    expect(normalizeDataDir('')).toEqual({ ok: true, path: '' });
    expect(normalizeDataDir(undefined)).toEqual({ ok: true, path: '' });
  });
  it('rejects /, ., ./ and ..', () => {
    for (const d of ['/', '.', './', '../a']) expect(normalizeDataDir(d).ok).toBe(false);
  });
  it('accepts a/b', () => {
    expect(normalizeDataDir('a/b')).toEqual({ ok: true, path: 'a/b' });
  });
  it('encodes a raw directory', () => {
    expect(normalizeDataDir('Token Art')).toEqual({ ok: true, path: 'Token%20Art' });
  });
});

describe('isImagePath', () => {
  it('accepts image extensions case-insensitively', () => {
    for (const p of ['a.png', 'a.JPG', 'a/b.jpeg', 'a.WebP']) expect(isImagePath(p)).toBe(true);
  });
  it('rejects others', () => {
    for (const p of [
      'foo.svg',
      'foo.png.svg',
      'foo.SVG',
      'foo',
      '../a.png',
      '',
      'x.svg',
      'x%2Esvg',
      'x%2esvg',
    ]) {
      expect(isImagePath(p)).toBe(false);
    }
  });
});
