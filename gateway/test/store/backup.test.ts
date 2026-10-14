import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';
import m001 from '../../src/store/migrations/001-pairings.js';
import { freePort, until } from '../relay/harness.js';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const c of children.splice(0)) {
    if (c.exitCode === null) {
      c.kill('SIGTERM');
      await new Promise((r) => c.once('exit', r));
    }
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmpDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ag-bak-'));
  dirs.push(d);
  return d;
};
const run = (...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 15_000 });

function seed(db: string): void {
  const store = openStore(db);
  store.createPairing({
    id: 'p1',
    tokenHash: 'h1',
    worldId: 'w1',
    userId: 'u1',
    userName: 'one',
    origin: 'http://localhost:30000',
  });
  store.setHttpTokenHash('a'.repeat(64));
  store.close();
}

describe('--backup', () => {
  it('copies a database that a running gateway holds, and the copy opens with the same rows', async () => {
    const dir = tmpDir();
    const db = join(dir, 'g.db');
    seed(db);
    const link = await freePort();
    let http = await freePort();
    while (http === link) http = await freePort();
    const gw = spawn(
      process.execPath,
      [cli, '--server-mode', '--db', db, '--link-port', String(link), '--http-port', String(http)],
      { stdio: ['pipe', 'ignore', 'pipe'] },
    );
    children.push(gw);
    gw.stdin!.end();
    let err = '';
    gw.stderr!.on('data', (d: Buffer) => (err += d.toString()));
    await until(() => err.includes('MCP HTTP at'), 15_000, 'gateway start');

    const target = join(dir, 'b.db');
    const r = run('--backup', target, '--db', db);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(target);
    expect(r.stdout).toMatch(/\d+ bytes/);

    const copy = openStore(target);
    expect(copy.listActivePairings().map((p) => [p.id, p.userId, p.userName])).toEqual([
      ['p1', 'u1', 'one'],
    ]);
    expect(copy.getHttpTokenHash()).toBe('a'.repeat(64));
    copy.close();
    expect(readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
  }, 30_000);

  it.skipIf(process.platform === 'win32')('creates the file with mode 0600', () => {
    const dir = tmpDir();
    const db = join(dir, 'g.db');
    seed(db);
    const target = join(dir, 'b.db');
    expect(run('--backup', target, '--db', db).status).toBe(0);
    expect(statSync(target).mode & 0o777).toBe(0o600);
  });

  it('refuses an existing target with exit 1 and leaves it unchanged', () => {
    const dir = tmpDir();
    const db = join(dir, 'g.db');
    seed(db);
    const target = join(dir, 'b.db');
    expect(run('--backup', target, '--db', db).status).toBe(0);
    const before = statSync(target);
    const again = run('--backup', target, '--db', db);
    expect(again.status).toBe(1);
    expect(again.stderr).toContain(target);
    expect(statSync(target).mtimeMs).toBe(before.mtimeMs);
    expect(statSync(target).size).toBe(before.size);
    expect(readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
  });

  it('refuses a database behind the current schema without migrating it', () => {
    const dir = tmpDir();
    const db = join(dir, 'old.db');
    const old = new DatabaseSync(db);
    old.exec(m001);
    old.exec('PRAGMA user_version = 1');
    old.close();
    const target = join(dir, 'b.db');
    const r = run('--backup', target, '--db', db);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/start the gateway once/);
    expect(existsSync(target)).toBe(false);
    const check = new DatabaseSync(db, { readOnly: true });
    expect(
      (check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
    ).toBe(1);
    check.close();
  });

  it('refuses :memory: with exit 2', () => {
    expect(run('--backup', join(tmpDir(), 'b.db'), '--db', ':memory:').status).toBe(2);
  });

  it('refuses a missing database with exit 1', () => {
    const dir = tmpDir();
    const r = run('--backup', join(dir, 'b.db'), '--db', join(dir, 'none.db'));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/start the gateway once/);
  });
});

describe('--help', () => {
  it('lists --backup and every exposure flag', () => {
    const r = run('--help');
    for (const flag of [
      '--backup',
      '--public-url',
      '--server-mode',
      '--link-host',
      '--http-host',
      '--trust-proxy',
      '--http',
      '--allow-origin',
    ])
      expect(r.stdout).toContain(flag);
  });
});
