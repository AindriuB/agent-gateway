import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { e2ePaths, profileDir, type E2ePaths } from './config.js';
import {
  ensureStateDirs,
  preflightMessage,
  preflightState,
  readActivePairings,
  SETUP_HINT,
  tightenDb,
} from './state.js';

let home: string;
let paths: E2ePaths;
const mode = (p: string) => statSync(p).mode & 0o777;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ag-e2e-state-'));
  paths = e2ePaths(home);
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const pairings = (names: string[]) => () =>
  names.map((userName) => ({ worldId: 'test-world', userName }));
const base = () => ({ paths, world: 'test-world', users: ['dev-gm', 'player1'] });

describe('state directories', () => {
  it('creates the tree at 0700 and tightens the DB to 0600', () => {
    ensureStateDirs(paths, ['dev-gm', 'player1']);
    for (const d of [paths.stateDir, paths.profilesDir, profileDir(paths, 'dev-gm')]) {
      expect(mode(d)).toBe(0o700);
    }
    writeFileSync(paths.db, '', { mode: 0o644 });
    tightenDb(paths);
    expect(mode(paths.db)).toBe(0o600);
  });

  it('tightens a directory that already exists with a loose mode', () => {
    ensureStateDirs(paths, []);
    chmodSync(paths.stateDir, 0o755);
    ensureStateDirs(paths, []);
    expect(mode(paths.stateDir)).toBe(0o700);
  });
});

describe('preflightState', () => {
  it('reports a missing profile and a missing DB, with the setup hint', () => {
    const problems = preflightState({ ...base(), readPairings: pairings([]) });
    expect(problems.join('\n')).toMatch(/no browser profile for dev-gm/);
    expect(problems.join('\n')).toMatch(/no gateway database/);
    expect(preflightMessage(problems)).toContain(SETUP_HINT);
  });

  it('reports a user with no active pairing', () => {
    ensureStateDirs(paths, ['dev-gm', 'player1']);
    writeFileSync(paths.db, '', { mode: 0o600 });
    const problems = preflightState({ ...base(), readPairings: pairings(['dev-gm']) });
    expect(problems).toEqual(['no active pairing for player1 in world test-world']);
  });

  it('passes when everything exists', () => {
    ensureStateDirs(paths, ['dev-gm', 'player1']);
    writeFileSync(paths.db, '', { mode: 0o600 });
    expect(preflightState({ ...base(), readPairings: pairings(['dev-gm', 'player1']) })).toEqual(
      [],
    );
  });

  it('flags loose modes', () => {
    ensureStateDirs(paths, ['dev-gm', 'player1']);
    writeFileSync(paths.db, '', { mode: 0o600 });
    chmodSync(paths.db, 0o644);
    const problems = preflightState({ ...base(), readPairings: pairings(['dev-gm', 'player1']) });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/mode 644, expected 600/);
  });

  it('turns an unreadable DB into a problem, not a throw', () => {
    ensureStateDirs(paths, ['dev-gm', 'player1']);
    writeFileSync(paths.db, 'not sqlite', { mode: 0o600 });
    const problems = preflightState(base());
    expect(problems.join('\n')).toMatch(/cannot read the gateway database/);
  });
});

describe('readActivePairings', () => {
  it('returns only unrevoked rows', () => {
    ensureStateDirs(paths, []);
    const db = new DatabaseSync(paths.db);
    db.exec(
      'CREATE TABLE pairings (world_id TEXT, user_name TEXT, revoked_at INTEGER);' +
        "INSERT INTO pairings VALUES ('w','a',NULL),('w','b',5);",
    );
    db.close();
    expect(readActivePairings(paths.db)).toEqual([{ worldId: 'w', userName: 'a' }]);
  });
});
