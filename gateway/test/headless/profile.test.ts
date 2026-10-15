import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureProfileDir, profileDir } from '../../src/headless/profile.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ag-prof-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('profileDir', () => {
  const S = '/state';
  it('gives two agents distinct dirs', () => {
    expect(profileDir(S, 'w1', 'uA')).not.toBe(profileDir(S, 'w1', 'uB'));
  });
  it('tells ids that differ only in case apart', () => {
    expect(profileDir(S, 'w1', 'AbC')).not.toBe(profileDir(S, 'w1', 'abc'));
  });
  it('is stable', () => {
    expect(profileDir(S, 'w1', 'uA')).toBe(profileDir(S, 'w1', 'uA'));
  });
  it('stays under <state>/headless/profiles/ with a safe id, whatever the ids hold', () => {
    for (const [w, u] of [
      ['w1', 'uA'],
      ['../..', '/etc/passwd'],
      ['a b', '..'],
      ['x'.repeat(200), 'y'.repeat(200)],
      ['é', '\u0000'],
    ] as const) {
      const dir = profileDir(S, w, u);
      expect(dir.startsWith(`${S}/headless/profiles/`)).toBe(true);
      const id = dir.slice(`${S}/headless/profiles/`.length);
      expect(id).toMatch(/^[a-z0-9-]{1,48}-[0-9a-f]{12}$/);
    }
  });
});

describe.skipIf(process.platform === 'win32')('ensureProfileDir', () => {
  it('creates 0700 dirs', () => {
    const s = tmp();
    const r = ensureProfileDir(s, 'w1', 'uA');
    expect(r.ok).toBe(true);
    for (const p of [
      join(s, 'headless'),
      join(s, 'headless', 'profiles'),
      profileDir(s, 'w1', 'uA'),
    ])
      expect(statSync(p).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlinked profiles/', () => {
    const s = tmp();
    const elsewhere = tmp();
    mkdirSync(join(s, 'headless'));
    symlinkSync(elsewhere, join(s, 'headless', 'profiles'));
    const r = ensureProfileDir(s, 'w1', 'uA');
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toContain('symlink');
  });
});
