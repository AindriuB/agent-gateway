import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';

const dir = (): string => mkdtempSync(join(tmpdir(), 'ag-store-'));

describe('store', () => {
  it('creates, finds and revokes pairings', () => {
    const s = openStore(':memory:', () => 42);
    const row = s.createPairing({ id: 'a1', tokenHash: 'h', worldId: 'w', userId: 'u' });
    expect(row).toEqual({
      id: 'a1',
      tokenHash: 'h',
      worldId: 'w',
      userId: 'u',
      createdAt: 42,
      revokedAt: null,
    });
    expect(s.findPairingByHash('h')?.id).toBe('a1');
    expect(s.findPairingByHash('x')).toBeUndefined();
    expect(s.revokePairing('a1')).toBe(true);
    expect(s.findPairingByHash('h')?.revokedAt).toBe(42);
    expect(s.revokePairing('a1')).toBe(false);
  });

  it('migrates a file store once and reopens it', () => {
    const path = join(dir(), 'g.db');
    const s = openStore(path);
    s.createPairing({ id: 'a1', tokenHash: 'h', worldId: 'w', userId: 'u' });
    s.close();
    const again = openStore(path);
    expect(again.findPairingByHash('h')?.id).toBe('a1');
    again.close();
  });

  it('keeps only the hash in the database file', () => {
    const d = dir();
    const s = openStore(join(d, 'g.db'));
    const token = 'RAW-TOKEN-should-never-be-stored';
    s.createPairing({ id: 'a1', tokenHash: 'hashed-value', worldId: 'w', userId: 'u' });
    s.close();
    for (const f of readdirSync(d)) {
      expect(readFileSync(join(d, f)).includes(token)).toBe(false);
    }
  });
});
