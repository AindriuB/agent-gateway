import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { INVITE_CODE_PATTERN, INVITE_TTL_MS } from '../../src/link/invites.js';
import { openStore, type Store } from '../../src/store/index.js';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-invcli-'));
  dirs.push(d);
  const path = join(d, 'g.db');
  openStore(path).close();
  return path;
}

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
function run(db: string, ...args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, '--db', db, ...args], {
      env: { ...process.env, AGENT_GATEWAY_DB: '' },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const withStore = <T>(path: string, fn: (s: Store) => T): T => {
  const s = openStore(path);
  try {
    return fn(s);
  } finally {
    s.close();
  }
};
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const seedPairing = (path: string, userId = 'u1', tokenHash = `th-${userId}`) =>
  withStore(path, (s) =>
    s.createPairing({
      id: `p-${userId}`,
      tokenHash,
      worldId: 'w1',
      userId,
      userName: 'Al\x1b[31mice',
      origin: 'http://localhost:30000',
    }),
  );
const seedGrant = (path: string) =>
  withStore(path, (s) => {
    s.oauth.createClient({
      id: 'c',
      secretHash: null,
      name: 'n',
      redirectUris: ['https://c.example/cb'],
      createdAt: 1,
    });
    s.oauth.createGrant({
      id: 'g1',
      clientId: 'c',
      worldId: 'w1',
      userId: 'u1',
      scopes: ['read'],
      createdAt: 1,
    });
  });
const codeOf = async (db: string, ...extra: string[]): Promise<string> => {
  const r = await run(db, '--invite', 'w1', 'u1', ...extra);
  expect(r.status).toBe(0);
  return r.stdout.trim();
};

describe('--invite', { timeout: 20_000 }, () => {
  it('prints one code alone on stdout; the row holds only its hash and a 24 h expiry', async () => {
    const db = mkDb();
    const before = Date.now();
    const r = await run(db, '--invite', 'w1', 'u1');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^${INVITE_CODE_PATTERN.source.slice(1, -1)}\\n$`));
    const code = r.stdout.trim();
    expect(r.stderr).not.toContain(code);
    const rows = withStore(db, (s) => s.invites.list());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      codeHash: sha(code),
      worldId: 'w1',
      userId: 'u1',
      origin: null,
      usedAt: null,
    });
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(Math.abs(rows[0]!.expiresAt - rows[0]!.createdAt - INVITE_TTL_MS)).toBeLessThan(50);
    expect(rows[0]!.createdAt).toBeGreaterThanOrEqual(before);
  });

  it('accepts --ttl 30m and 7d, and refuses 8d with exit 2', async () => {
    const db = mkDb();
    await codeOf(db, '--ttl', '30m');
    await codeOf(db, '--ttl', '7d');
    const rows = withStore(db, (s) => s.invites.list());
    // created_at and the expiry come from two clock reads, a few ms apart at most.
    const spans = rows.map((i) => i.expiresAt - i.createdAt);
    expect(Math.abs(spans[0]! - 30 * 60_000)).toBeLessThan(50);
    expect(Math.abs(spans[1]! - 7 * 86_400_000)).toBeLessThan(50);
    const bad = await run(db, '--invite', 'w1', 'u1', '--ttl', '8d');
    expect(bad.status).toBe(2);
    expect(withStore(db, (s) => s.invites.list())).toHaveLength(2);
  });

  it('pins --origin, and refuses a malformed one or missing ids with exit 2', async () => {
    const db = mkDb();
    await codeOf(db, '--origin', 'https://foundry.example.com');
    expect(withStore(db, (s) => s.invites.list())[0]!.origin).toBe('https://foundry.example.com');
    expect((await run(db, '--invite', 'w1', 'u1', '--origin', 'not an origin')).status).toBe(2);
    expect((await run(db, '--invite', 'w1')).status).toBe(2);
    expect((await run(db, '--invite', 'w1', 'u1', 'extra')).status).toBe(2);
    expect((await run(db, '--invite', 'w'.repeat(65), 'u1')).status).toBe(2);
    expect((await run(db, '--revoke-pairing', 'w1', 'u1', '--ttl', '1h')).status).toBe(2);
  });

  it('refuses a database that is behind, without migrating it', async () => {
    const d = mkdtempSync(join(tmpdir(), 'ag-invcli-'));
    dirs.push(d);
    const r = await run(join(d, 'missing.db'), '--invite', 'w1', 'u1');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/start the gateway once/);
  });
});

describe('--revoke-pairing and --cancel-invite', { timeout: 20_000 }, () => {
  it('revoke-pairing revokes the pairing and grants and cancels the target unused invites', async () => {
    const db = mkDb();
    seedPairing(db);
    seedPairing(db, 'u2');
    seedGrant(db);
    const code = await codeOf(db);
    const r = await run(db, '--revoke-pairing', 'w1', 'u1');
    expect(r.status).toBe(0);
    withStore(db, (s) => {
      expect(s.listActivePairings().map((p) => p.userId)).toEqual(['u2']);
      expect(s.oauth.getGrant('g1')?.revokedAt).not.toBeNull();
      expect(s.invites.findByHash(sha(code))).toMatchObject({ result: 'cancelled' });
    });
  });

  it('a grant-revocation failure exits 1 and changes nothing', async () => {
    const db = mkDb();
    seedPairing(db);
    seedGrant(db);
    const code = await codeOf(db);
    const raw = new DatabaseSync(db);
    raw.exec('PRAGMA busy_timeout = 5000');
    raw.exec(
      "CREATE TRIGGER boom BEFORE UPDATE ON oauth_grants BEGIN SELECT RAISE(ABORT, 'boom'); END",
    );
    raw.close();
    const r = await run(db, '--revoke-pairing', 'w1', 'u1');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/nothing changed/);
    withStore(db, (s) => {
      expect(s.listActivePairings()).toHaveLength(1);
      expect(s.invites.findByHash(sha(code))).toMatchObject({ cancelledAt: null, result: null });
    });
  });

  it('cancel-invite cancels the target invites only, and leaves pairings alone', async () => {
    const db = mkDb();
    seedPairing(db);
    const c1 = await codeOf(db);
    const other = await run(db, '--invite', 'w1', 'u2');
    const r = await run(db, '--cancel-invite', 'w1', 'u1');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('1');
    withStore(db, (s) => {
      expect(s.invites.findByHash(sha(c1))).toMatchObject({ result: 'cancelled' });
      expect(s.invites.findByHash(sha(other.stdout.trim()))).toMatchObject({ cancelledAt: null });
      expect(s.listActivePairings()).toHaveLength(1);
    });
  });

  it('cancel-invite with nothing to cancel exits 1 and changes nothing', async () => {
    const db = mkDb();
    const before = withStore(db, (s) => JSON.stringify(s.invites.list()));
    const r = await run(db, '--cancel-invite', 'w1', 'u1');
    expect(r.status).toBe(1);
    expect(withStore(db, (s) => JSON.stringify(s.invites.list()))).toBe(before);
  });
});

describe('--list-invites and --list-pairings', { timeout: 20_000 }, () => {
  it('show status and ids, and print no code, token or hash', async () => {
    const db = mkDb();
    seedPairing(db, 'u1', 'secret-token-hash-1');
    const revoked = await codeOf(db);
    await run(db, '--revoke-pairing', 'w1', 'u1');
    seedPairing(db, 'u3', 'secret-token-hash-3');
    const cancelled = await run(db, '--invite', 'w1', 'u2');
    await run(db, '--cancel-invite', 'w1', 'u2');
    const live = await codeOf(db, '--ttl', '1h');
    const inv = await run(db, '--list-invites');
    const pair = await run(db, '--list-pairings');
    expect(inv.status).toBe(0);
    expect(inv.stdout.match(/cancelled/g)).toHaveLength(2);
    expect(inv.stdout).toMatch(/live/);
    const ids = withStore(db, (s) => s.invites.list().map((i) => i.id.slice(0, 8)));
    for (const id of ids) expect(inv.stdout).toContain(id);
    expect(pair.stdout).toContain('u3');
    expect(pair.stdout).not.toMatch(/[\x00-\x09\x0b-\x1f]/);
    const hashes = withStore(db, (s) => [
      ...s.invites.list().map((i) => i.codeHash),
      ...s.listPairings().map((p) => p.tokenHash),
    ]);
    const secrets = [revoked, live, cancelled.stdout.trim(), ...hashes];
    for (const out of [inv.stdout + inv.stderr, pair.stdout + pair.stderr])
      for (const secret of secrets) expect(out).not.toContain(secret);
  });
});

describe('a concurrent writer holding the write lock', { timeout: 20_000 }, () => {
  /** Hold BEGIN IMMEDIATE on the db for ~500 ms while `fn` runs. */
  async function whileLocked(db: string, fn: () => Promise<Run>): Promise<{ r: Run; ms: number }> {
    const holder = new DatabaseSync(db);
    holder.exec('PRAGMA busy_timeout = 5000');
    holder.exec('BEGIN IMMEDIATE');
    const t = setTimeout(() => holder.exec('COMMIT'), 500);
    const start = Date.now();
    try {
      const r = await fn();
      return { r, ms: Date.now() - start };
    } finally {
      clearTimeout(t);
      if (holder.isTransaction) holder.exec('ROLLBACK');
      holder.close();
    }
  }

  it('--invite waits, then succeeds', async () => {
    const db = mkDb();
    const { r, ms } = await whileLocked(db, () => run(db, '--invite', 'w1', 'u1'));
    expect(r.status).toBe(0);
    expect(ms).toBeGreaterThanOrEqual(400);
    expect(withStore(db, (s) => s.invites.list())).toHaveLength(1);
  });

  it('--revoke-pairing waits, then succeeds', async () => {
    const db = mkDb();
    seedPairing(db);
    const { r } = await whileLocked(db, () => run(db, '--revoke-pairing', 'w1', 'u1'));
    expect(r.status).toBe(0);
    expect(withStore(db, (s) => s.listActivePairings())).toEqual([]);
  });

  it('--cancel-invite waits, then succeeds', async () => {
    const db = mkDb();
    const code = await codeOf(db);
    const { r } = await whileLocked(db, () => run(db, '--cancel-invite', 'w1', 'u1'));
    expect(r.status).toBe(0);
    expect(withStore(db, (s) => s.invites.findByHash(sha(code)))).toMatchObject({
      result: 'cancelled',
    });
  });
});
