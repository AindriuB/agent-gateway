import type { DatabaseSync } from 'node:sqlite';

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
