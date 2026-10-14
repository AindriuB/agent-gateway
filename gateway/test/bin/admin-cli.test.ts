import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { LinkMessage } from '@agent-gateway/protocol';
import { hashInviteCode } from '../../src/link/invites.js';
import { openStore } from '../../src/store/index.js';
import { ORIGIN, TestClient, hello, startServer, type Harness } from '../link/helpers.js';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const HOUR = 3_600_000;
const dirs: string[] = [];
let h: Harness | undefined;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

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
function mkDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-admcli-'));
  dirs.push(d);
  const path = join(d, 'g.db');
  openStore(path).close();
  return path;
}
const rows = (db: string) => {
  const s = openStore(db);
  try {
    return s.invites.list();
  } finally {
    s.close();
  }
};

describe.each(['--admin', '--gm'])('%s invites', { timeout: 20_000 }, (flag) => {
  const isAdmin = flag === '--admin';
  const mint = (db: string, ...extra: string[]) =>
    run(db, '--invite', 'w1', 'u1', flag, '--origin', ORIGIN, ...extra);

  it('sets the flags, leaves created_by null and prints like a normal invite', async () => {
    const db = mkDb();
    const r = await mint(db);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\n$/);
    const [inv] = rows(db);
    expect(inv).toMatchObject({
      admin: isAdmin,
      gm: true,
      createdBy: null,
      origin: ORIGIN,
      codeHash: hashInviteCode(r.stdout.trim()),
    });
  });

  it('exits 2 naming --origin without it, and 2 without --invite', async () => {
    const db = mkDb();
    const a = await run(db, '--invite', 'w1', 'u1', flag);
    expect(a.status).toBe(2);
    expect(a.stderr).toContain(`${flag} needs --origin`);
    const b = await run(db, flag, 'w1', 'u1');
    expect(b.status).toBe(2);
    const c = await run(db, flag);
    expect(c.status).toBe(2);
    expect(c.stderr).toContain(`${flag} goes with --invite`);
    expect(rows(db)).toEqual([]);
  });

  it('defaults to 1 h, accepts 24 h and refuses 25 h', async () => {
    const db = mkDb();
    await mint(db);
    await mint(db, '--ttl', '24h');
    const spans = rows(db).map((i) => i.expiresAt - i.createdAt);
    expect(Math.abs(spans[0]! - HOUR)).toBeLessThan(50);
    expect(Math.abs(spans[1]! - 24 * HOUR)).toBeLessThan(50);
    const bad = await mint(db, '--ttl', '25h');
    expect(bad.status).toBe(2);
    expect(rows(db)).toHaveLength(2);
  });

  it('redeems over a link without a pairingChallenge', async () => {
    h = await startServer({ serverMode: true });
    const r = await run(h.dbPath, '--invite', 'w1', 'u1', flag, '--origin', ORIGIN);
    const c = await TestClient.connect(h.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: r.stdout.trim() }, { isGM: false }));
    expect(await c.next()).toMatchObject({ type: 'welcome', admin: isAdmin });
    expect(c.messages.some((m) => m.type === 'pairingChallenge')).toBe(false);
    expect(h.store.listActivePairings()[0]).toMatchObject({ userId: 'u1', admin: isAdmin });
  });
});

describe('--gm with --admin', { timeout: 20_000 }, () => {
  it('behaves exactly as --admin', async () => {
    const db = mkDb();
    const r = await run(db, '--invite', 'w1', 'u1', '--gm', '--admin', '--origin', ORIGIN);
    expect(r.status).toBe(0);
    expect(rows(db)[0]).toMatchObject({ admin: true, gm: true });
    expect((await run(db, '--invite', 'w1', 'u2', '--gm', '--admin')).status).toBe(2);
  });
});

describe('a plain --invite', { timeout: 20_000 }, () => {
  it('has neither flag, keeps the 24 h default and 7 d cap, and needs a vouch', async () => {
    h = await startServer({ serverMode: true });
    const r = await run(h.dbPath, '--invite', 'w1', 'u1');
    expect(r.status).toBe(0);
    const [inv] = rows(h.dbPath);
    expect(inv).toMatchObject({ admin: false, gm: false });
    expect(Math.abs(inv!.expiresAt - inv!.createdAt - 24 * HOUR)).toBeLessThan(50);
    expect((await run(h.dbPath, '--invite', 'w1', 'u1', '--ttl', '7d')).status).toBe(0);
    expect((await run(h.dbPath, '--invite', 'w1', 'u1', '--ttl', '8d')).status).toBe(2);
    const c = await TestClient.connect(h.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code: r.stdout.trim() }, { isGM: false }));
    expect(await c.next()).toMatchObject({ type: 'reject', code: 'PAIRING_UNCONFIRMED' });
    expect(h.store.invites.findByHash(hashInviteCode(r.stdout.trim()))!.usedAt).toBeNull();
  });
});

describe('--demote', { timeout: 20_000 }, () => {
  const adminPair = async (db: string, user = 'gm1') => {
    const r = await run(db, '--invite', 'w1', user, '--admin', '--origin', ORIGIN);
    return r.stdout.trim();
  };

  it('clears admin only, exits 1 when there is none, and keeps grants and invites', async () => {
    h = await startServer({ serverMode: true });
    const code = await adminPair(h.dbPath);
    const c = await TestClient.connect(h.port, ORIGIN);
    clients.push(c);
    c.send(hello({ kind: 'pairingCode', code }, { userId: 'gm1' }));
    await c.next('welcome');
    h.store.oauth.createClient({
      id: 'c',
      secretHash: null,
      name: 'n',
      redirectUris: ['https://c.example/cb'],
      createdAt: 1,
    });
    h.store.oauth.createGrant({
      id: 'g1',
      clientId: 'c',
      worldId: 'w1',
      userId: 'gm1',
      scopes: ['read'],
      createdAt: 1,
    });
    await run(h.dbPath, '--invite', 'w1', 'gm1');
    const before = rows(h.dbPath).length;
    for (const [w, u] of [
      ['w1', 'nobody'],
      ['w2', 'gm1'],
    ] as const) {
      expect((await run(h.dbPath, '--demote', w, u)).status).toBe(1);
      expect(h.store.listActivePairings()[0]).toMatchObject({ userId: 'gm1', admin: true });
    }
    const r = await run(h.dbPath, '--demote', 'w1', 'gm1');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Demoted 1');
    expect(h.store.listActivePairings()[0]).toMatchObject({ userId: 'gm1', admin: false });
    expect(h.store.oauth.getGrant('g1')?.revokedAt ?? null).toBeNull();
    expect(rows(h.dbPath)).toHaveLength(before);
    expect(rows(h.dbPath).filter((i) => i.result === 'cancelled')).toEqual([]);
    const again = await run(h.dbPath, '--demote', 'w1', 'gm1');
    expect(again.status).toBe(1);
  });

  it('refuses the next attest from a running gateway', async () => {
    h = await startServer({ serverMode: true });
    const gm = await TestClient.connect(h.port, ORIGIN);
    clients.push(gm);
    gm.send(hello({ kind: 'pairingCode', code: await adminPair(h.dbPath) }, { userId: 'gm1' }));
    await gm.next('welcome');
    const p = await run(h.dbPath, '--invite', 'w1', 'p1');
    const pc = await TestClient.connect(h.port, ORIGIN);
    clients.push(pc);
    pc.send(hello({ kind: 'pairingCode', code: p.stdout.trim() }, { userId: 'p1' }));
    const first: LinkMessage = await pc.next();
    expect(first).toMatchObject({ type: 'pairingChallenge' });
    expect((await run(h.dbPath, '--demote', 'w1', 'gm1')).status).toBe(0);
    gm.send({
      type: 'attest',
      nonce: (first as { nonce: string }).nonce,
      authorId: 'p1',
      authorIsGM: false,
    });
    expect(await gm.next('error')).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('needs both ids, and rejects --admin or --ttl with it', async () => {
    const db = mkDb();
    expect((await run(db, '--demote', 'w1')).status).toBe(2);
    expect((await run(db, '--demote', 'w1', 'u1', '--admin')).status).toBe(2);
    expect((await run(db, '--demote', 'w1', 'u1', '--ttl', '1h')).status).toBe(2);
  });

  it('has no promote: --admin never touches an existing pairing', async () => {
    const db = mkDb();
    const s = openStore(db);
    s.createPairing({ id: 'p', tokenHash: 'th', worldId: 'w1', userId: 'u1', origin: ORIGIN });
    s.close();
    expect((await run(db, '--admin', 'w1', 'u1')).status).toBe(2);
    const s2 = openStore(db);
    expect(s2.listPairings()[0]!.admin).toBe(false);
    s2.close();
  });
});

describe('lists and help', { timeout: 20_000 }, () => {
  it('show admin and kind columns and print no secret', async () => {
    const db = mkDb();
    const a = await run(db, '--invite', 'w1', 'gm1', '--admin', '--origin', ORIGIN);
    const g = await run(db, '--invite', 'w1', 'gm2', '--gm', '--origin', ORIGIN);
    const p = await run(db, '--invite', 'w1', 'p1');
    const s = openStore(db);
    s.createPairing({
      id: 'pa',
      tokenHash: 'secret-hash-a',
      worldId: 'w1',
      userId: 'gm1',
      origin: ORIGIN,
      admin: true,
    });
    s.createPairing({
      id: 'pb',
      tokenHash: 'secret-hash-b',
      worldId: 'w1',
      userId: 'p1',
      origin: ORIGIN,
    });
    s.close();
    const inv = await run(db, '--list-invites');
    const lines = inv.stdout.trim().split('\n');
    expect(lines.find((l) => l.includes('gm1'))).toMatch(/\s+kind admin\s/);
    expect(lines.find((l) => l.includes('gm2'))).toMatch(/\s+kind gm\s/);
    expect(lines.find((l) => l.includes('p1'))).toMatch(/\s+kind -\s/);
    const pair = await run(db, '--list-pairings');
    const pl = pair.stdout.trim().split('\n');
    expect(pl.find((l) => l.includes('gm1'))).toMatch(/\s+admin\s/);
    expect(pl.find((l) => l.includes('p1'))).not.toMatch(/\sadmin\s/);
    const codes = [a, g, p].map((r) => r.stdout.trim());
    const secrets = [...codes, ...codes.map(hashInviteCode), 'secret-hash-a', 'secret-hash-b'];
    for (const out of [inv.stdout + inv.stderr, pair.stdout + pair.stderr])
      for (const secret of secrets) expect(out).not.toContain(secret);
  });

  it('--help documents the flags and the trust warnings', async () => {
    const r = await run(mkDb(), '--help');
    expect(r.stdout).toContain('--admin');
    expect(r.stdout).toContain('--gm');
    expect(r.stdout).toContain('--demote');
    expect(r.stdout).toMatch(/skips the GM vouch/);
    expect(r.stdout).toMatch(/only for GM user\s+accounts/);
    expect(r.stdout).toMatch(/needs a live admin GM to confirm/);
  });
});
