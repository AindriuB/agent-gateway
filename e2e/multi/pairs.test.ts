import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  activePairingIds,
  ambiguityProblems,
  countActivePairings,
  hasPairing,
  isWorldOffline,
  judgeReloadProbe,
} from './pairs.js';

const rows = [
  { worldId: 'test-world', userName: 'dev-gm' },
  { worldId: 'test-world', userName: 'Player1' },
];

describe('pairing counts and skip logic', () => {
  it('counts the pairings the reader returns', () => {
    expect(countActivePairings('x', () => rows)).toBe(2);
    expect(countActivePairings('x', () => [])).toBe(0);
  });
  it('finds a user in the world case-insensitively', () => {
    expect(hasPairing('x', 'test-world', 'player1', () => rows)).toBe(true);
    expect(hasPairing('x', 'test-world', 'player2', () => rows)).toBe(false);
    expect(hasPairing('x', 'other-world', 'player1', () => rows)).toBe(false);
  });
  it('treats an unreadable DB as no pairing', () => {
    expect(
      hasPairing('x', 'w', 'u', () => {
        throw new Error('no db');
      }),
    ).toBe(false);
  });
});

describe('ambiguityProblems', () => {
  const text =
    'INVALID_ARGS: Several Foundry users are paired; start the gateway with --world and --user to choose one. Available: world test-world / user dev-gm; world test-world / user Player1';
  it('accepts the gateway text naming both users', () => {
    expect(ambiguityProblems(text, ['dev-gm', 'player1'])).toEqual([]);
  });
  it('reports a wrong code and a missing user', () => {
    expect(ambiguityProblems('WORLD_OFFLINE: world offline', ['dev-gm'])).toHaveLength(2);
    expect(ambiguityProblems(text, ['dev-gm', 'player2'])).toEqual(['does not name player2']);
  });
});

describe('judgeReloadProbe', () => {
  const ok = { isError: false, text: 'fine' };
  const off = { isError: true, text: 'WORLD_OFFLINE: world offline' };
  it('waits through successes before the navigation, then needs an offline result first', () => {
    expect(judgeReloadProbe(ok, { sawOffline: false, startedAfterNavigation: false }).verdict).toBe(
      'continue',
    );
    expect(
      judgeReloadProbe(off, { sawOffline: false, startedAfterNavigation: false }),
    ).toMatchObject({
      verdict: 'continue',
      sawOffline: true,
    });
    expect(judgeReloadProbe(ok, { sawOffline: true, startedAfterNavigation: true }).verdict).toBe(
      'recovered',
    );
  });
  it('ignores a success from a probe sent before the navigation, even if it returns after', () => {
    // The probe began on the old connection; navigation committed while it was in flight.
    expect(judgeReloadProbe(ok, { sawOffline: false, startedAfterNavigation: false }).verdict).toBe(
      'continue',
    );
  });
  it('fails on a success after navigation with no offline result, and on other errors', () => {
    expect(judgeReloadProbe(ok, { sawOffline: false, startedAfterNavigation: true }).verdict).toBe(
      'failed',
    );
    expect(
      judgeReloadProbe(
        { isError: true, text: 'INTERNAL: x' },
        { sawOffline: true, startedAfterNavigation: true },
      ).verdict,
    ).toBe('failed');
  });
});

describe('isWorldOffline', () => {
  it('matches the WORLD_OFFLINE prefix only', () => {
    expect(isWorldOffline('WORLD_OFFLINE: world offline: x')).toBe(true);
    expect(isWorldOffline('INVALID_ARGS: world offline')).toBe(false);
  });
});

describe('activePairingIds', () => {
  it('lists active ids sorted and skips revoked rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-pairs-'));
    try {
      const path = join(dir, 'g.db');
      const db = new DatabaseSync(path);
      db.exec('CREATE TABLE pairings (id TEXT PRIMARY KEY, revoked_at INTEGER)');
      db.exec("INSERT INTO pairings VALUES ('b', NULL), ('a', NULL), ('c', 5)");
      db.close();
      expect(activePairingIds(path)).toEqual(['a', 'b']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
