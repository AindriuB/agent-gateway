import { DatabaseSync } from 'node:sqlite';
import { readActivePairings, type ActivePairing } from '../lib/state.js';

export const SKIP_PLAYER2 = 'SKIP: player2 not configured';

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Active (not revoked) pairings in the DB, read without opening it for writing. */
export function countActivePairings(
  dbPath: string,
  read: (p: string) => ActivePairing[] = readActivePairings,
): number {
  return read(dbPath).length;
}

/** True when `user` has an active pairing in `world`. A missing or unreadable DB counts as no. */
export function hasPairing(
  dbPath: string,
  world: string,
  user: string,
  read: (p: string) => ActivePairing[] = readActivePairings,
): boolean {
  try {
    return read(dbPath).some((p) => p.worldId === world && same(p.userName, user));
  } catch {
    return false;
  }
}

/**
 * Problems with an ambiguity answer: it must start with INVALID_ARGS and name every user.
 * Names are matched case-insensitively, because the gateway prints the name recorded at pairing.
 */
export function ambiguityProblems(text: string, users: readonly string[]): string[] {
  const problems: string[] = [];
  if (!text.startsWith('INVALID_ARGS')) {
    problems.push(`expected a result starting INVALID_ARGS, got: ${text.slice(0, 120)}`);
  }
  for (const u of users) {
    if (!text.toLowerCase().includes(u.toLowerCase())) problems.push(`does not name ${u}`);
  }
  return problems;
}

/** The text the gateway returns when the bound user is not connected. */
export function isWorldOffline(text: string): boolean {
  return text.startsWith('WORLD_OFFLINE');
}

/** Ids of the active (not revoked) pairing rows, sorted; read-only. */
export function activePairingIds(dbPath: string): string[] {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT id FROM pairings WHERE revoked_at IS NULL').all() as Array<{
      id: string;
    }>;
    return rows.map((r) => r.id).sort();
  } finally {
    db.close();
  }
}

export type ReloadVerdict = 'continue' | 'recovered' | 'failed';

/**
 * Judge one probe call after a reload. The link must be seen down (WORLD_OFFLINE) before a call
 * succeeds; a success after the reload's navigation without an earlier WORLD_OFFLINE means the
 * reload never dropped the link. Any other error is a failure.
 */
export function judgeReloadProbe(
  probe: { isError: boolean; text: string },
  state: { sawOffline: boolean; navigated: boolean },
): { verdict: ReloadVerdict; sawOffline: boolean; reason?: string } {
  if (isWorldOffline(probe.text)) return { verdict: 'continue', sawOffline: true };
  if (probe.isError) {
    return {
      verdict: 'failed',
      sawOffline: state.sawOffline,
      reason: `unexpected error: ${probe.text}`,
    };
  }
  if (state.sawOffline) return { verdict: 'recovered', sawOffline: true };
  if (state.navigated) {
    return {
      verdict: 'failed',
      sawOffline: false,
      reason:
        'a call succeeded after the reload without WORLD_OFFLINE first; the link was not dropped',
    };
  }
  return { verdict: 'continue', sawOffline: false };
}
