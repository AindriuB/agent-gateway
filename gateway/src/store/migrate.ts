import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

const DIR = new URL('./migrations/', import.meta.url);

/**
 * Loads every `NNN-name.(ts|js)` file in `migrations/` in filename order. Each
 * default-exports one SQL string. Insertion-only: tasks add files, never edit this.
 */
export async function loadMigrations(dir: URL = DIR): Promise<string[]> {
  const files = readdirSync(fileURLToPath(dir))
    .filter((f) => /^\d+.*\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
    .sort();
  const out: string[] = [];
  for (const f of files) {
    const mod = (await import(new URL(f, dir).href)) as { default: string };
    out.push(mod.default);
  }
  return out;
}

/** Applies migrations beyond `PRAGMA user_version`, each in its own transaction. */
export function applyMigrations(db: DatabaseSync, migrations: readonly string[]): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v] as string);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}
