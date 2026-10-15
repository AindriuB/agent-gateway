import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SLUG = 48;

/** `<slug>-<hash>`: stable, depends only on (world id, user id), and distinct for ids that differ in case. */
export function agentId(worldId: string, userId: string): string {
  const slug = `${worldId}-${userId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_SLUG);
  const hash = createHash('sha256')
    .update(JSON.stringify([worldId, userId]))
    .digest('hex')
    .slice(0, 12);
  return `${slug}-${hash}`;
}

/** `<state dir>/headless/profiles/<agent-id>/`: one Chromium user-data dir per agent. */
export function profileDir(stateDir: string, worldId: string, userId: string): string {
  return join(stateDir, 'headless', 'profiles', agentId(worldId, userId));
}

/** Why the profile path cannot be used; undefined when it was created or already safe. */
export function ensureProfileDir(
  stateDir: string,
  worldId: string,
  userId: string,
): { ok: true; dir: string } | { ok: false; reason: string } {
  const dir = profileDir(stateDir, worldId, userId);
  const uid = process.getuid?.();
  for (const path of [join(stateDir, 'headless'), join(stateDir, 'headless', 'profiles'), dir]) {
    try {
      let st = lstatSync(path, { throwIfNoEntry: false });
      if (!st) {
        mkdirSync(path, { mode: 0o700 });
        if (process.platform !== 'win32') chmodSync(path, 0o700);
        st = lstatSync(path);
      }
      if (st.isSymbolicLink()) return { ok: false, reason: `${path} is a symlink` };
      if (!st.isDirectory()) return { ok: false, reason: `${path} is not a directory` };
      if (uid !== undefined && st.uid !== uid)
        return { ok: false, reason: `${path} is not owned by the current user` };
    } catch (err) {
      return { ok: false, reason: `${path}: ${(err as Error).message}` };
    }
  }
  return { ok: true, dir };
}
