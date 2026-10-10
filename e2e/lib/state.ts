import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { profileDir, type E2ePaths } from './config.js';

export const SETUP_HINT = 'run npm run test:e2e:setup';
export const SEED_HINT = 'run npm run test:e2e:seed';

const mode = (path: string): number => statSync(path).mode & 0o777;

/** Create a directory (and parents) at 0700; tighten it when it already exists. */
export function ensurePrivateDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
}

/** Create the state tree: the state directory, profiles/ and one profile per user, all 0700. */
export function ensureStateDirs(paths: E2ePaths, users: readonly string[]): void {
  ensurePrivateDir(paths.stateDir);
  ensurePrivateDir(paths.profilesDir);
  for (const u of users) ensurePrivateDir(profileDir(paths, u));
}

/** The gateway creates the DB with the process umask; tighten it afterwards. */
export function tightenDb(paths: E2ePaths): void {
  if (existsSync(paths.db)) chmodSync(paths.db, 0o600);
}

export interface ActivePairing {
  worldId: string;
  userName: string;
}

/** Read active (not revoked) pairings without opening the DB for writing. */
export function readActivePairings(dbPath: string): ActivePairing[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare('SELECT world_id, user_name FROM pairings WHERE revoked_at IS NULL')
      .all() as Array<{ world_id: string; user_name: string }>;
    return rows.map((r) => ({ worldId: r.world_id, userName: r.user_name }));
  } finally {
    db.close();
  }
}

export interface PreflightInput {
  paths: E2ePaths;
  world: string;
  users: readonly string[];
  /** Injectable for tests. */
  readPairings?: (dbPath: string) => ActivePairing[];
}

/** Local state checks only; no network. Each problem line is operator-readable. */
export function preflightState(input: PreflightInput): string[] {
  const { paths, world, users } = input;
  const problems: string[] = [];
  for (const u of users) {
    const dir = profileDir(paths, u);
    if (!existsSync(dir)) problems.push(`no browser profile for ${u} (${dir})`);
  }
  for (const d of [paths.stateDir, paths.profilesDir]) {
    if (existsSync(d) && mode(d) !== 0o700) {
      problems.push(`${d} has mode ${mode(d).toString(8)}, expected 700`);
    }
  }
  if (!existsSync(paths.db)) {
    problems.push(`no gateway database (${paths.db})`);
  } else {
    if (mode(paths.db) !== 0o600) {
      problems.push(`${paths.db} has mode ${mode(paths.db).toString(8)}, expected 600`);
    }
    try {
      const pairings = (input.readPairings ?? readActivePairings)(paths.db);
      for (const u of users) {
        if (
          !pairings.some((p) => p.userName.toLowerCase() === u.toLowerCase() && p.worldId === world)
        ) {
          problems.push(`no active pairing for ${u} in world ${world}`);
        }
      }
    } catch (err) {
      problems.push(`cannot read the gateway database: ${(err as Error).message}`);
    }
  }
  return problems;
}

export function preflightMessage(problems: readonly string[]): string {
  return `E2E preflight failed:\n${problems.map((p) => `  - ${p}`).join('\n')}\n${SETUP_HINT}`;
}

export function ensureDbParent(paths: E2ePaths): void {
  ensurePrivateDir(dirname(paths.db));
}
