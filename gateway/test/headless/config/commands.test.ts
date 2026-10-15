import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runHeadlessCommand } from '../../../src/headless/config/commands.js';
import { openStore } from '../../../src/store/index.js';

const cli = fileURLToPath(new URL('../../../dist/bin/cli.js', import.meta.url));
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function freshDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-hc-'));
  dirs.push(d);
  const path = join(d, 'g.db');
  openStore(path).close();
  return path;
}

type Values = Parameters<typeof runHeadlessCommand>[0]['values'];
function run(
  dbPath: string,
  argv: string[],
  values: Values = {},
  flagAgent?: { worldId: string; userId: string },
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = runHeadlessCommand({
    argv,
    values,
    dbPath,
    schemaProblem: () => undefined,
    flagAgent: () => flagAgent,
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
  });
  return { code, out: out.join(''), err: err.join('') };
}

const add = (db: string, name: string, over: Values = {}) =>
  run(db, ['add', name], {
    'foundry-url': 'http://f.local:30000/',
    world: 'w1',
    user: 'u1',
    ...over,
  });

describe('headless add, list, remove', () => {
  it('stores a row and lists it without any password', () => {
    const db = freshDb();
    const r = add(db, 'a1', { owner: 'own1' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('AGENT_GATEWAY_HEADLESS_A1_PASSWORD');
    const list = run(db, ['list']);
    expect(list.code).toBe(0);
    expect(list.out).toContain('a1  w1  u1  owner own1  http://f.local:30000');
    expect(list.out.toLowerCase()).not.toContain('password');
  });

  it('refuses a password flag, a bad name, and a bad URL without echoing it', () => {
    const db = freshDb();
    expect(add(db, 'a1', { password: 'hunter2' })).toMatchObject({ code: 2 });
    expect(add(db, 'a1', { password: 'hunter2' }).err).not.toContain('hunter2');
    for (const bad of ['A1', '-a', 'a_b', 'x'.repeat(33), '']) expect(add(db, bad).code).toBe(2);
    const url = add(db, 'a1', { 'foundry-url': 'http://user:sekrit@f.local/?k=v' });
    expect(url.code).toBe(2);
    expect(url.err).not.toContain('sekrit');
    expect(url.err).not.toContain('f.local');
    expect(run(db, ['list']).out).toBe('');
  });

  it('refuses a world and user already used by a stored agent or the flag/env agent', () => {
    const db = freshDb();
    expect(add(db, 'a1').code).toBe(0);
    expect(add(db, 'a2').code).toBe(1);
    expect(add(db, 'a1', { user: 'u2' }).code).toBe(1);
    expect(add(db, 'a3', { world: 'w2' }).code).toBe(0);
    const flag = run(
      freshDb(),
      ['add', 'b1'],
      { 'foundry-url': 'http://f.local:30000', world: 'w1', user: 'u1' },
      { worldId: 'w1', userId: 'u1' },
    );
    expect(flag.code).toBe(2);
    expect(flag.err).toContain('already the headless agent');
  });

  it('remove deletes the row, revokes the pairings and keeps the profile', () => {
    const db = freshDb();
    expect(add(db, 'a1').code).toBe(0);
    const s = openStore(db);
    s.createPairing({ id: 'p1', tokenHash: 'h', worldId: 'w1', userId: 'u1', origin: 'http://f' });
    s.close();
    const r = run(db, ['remove', 'a1']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('revoked 1 pairing(s)');
    expect(r.out).toContain('headless/profiles/');
    expect(r.out).toContain('deleted once the gateway has restarted');
    const after = openStore(db);
    expect(after.headless.list()).toEqual([]);
    expect(after.listActivePairings()).toEqual([]);
    after.close();
    expect(run(db, ['remove', 'a1']).code).toBe(1);
  });
});

describe('the CLI process', () => {
  it('adds with a password in the environment and writes none to the database files', () => {
    const db = freshDb();
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'headless',
        'add',
        'a1',
        '--foundry-url',
        'http://f.local:30000',
        '--world',
        'w1',
        '--user',
        'u1',
        '--db',
        db,
      ],
      {
        encoding: 'utf8',
        timeout: 20_000,
        env: { ...process.env, AGENT_GATEWAY_HEADLESS_A1_PASSWORD: 'needle-pw-1234' },
      },
    );
    expect(r.status).toBe(0);
    const dir = join(db, '..');
    for (const f of readdirSync(dir))
      expect(readFileSync(join(dir, f)).includes('needle-pw-1234')).toBe(false);
    expect(existsSync(db)).toBe(true);
    const s = openStore(db);
    expect(s.headless.list().map((a) => a.name)).toEqual(['a1']);
    s.close();
  });

  it('refuses --password with exit 2 and no echo', () => {
    const db = freshDb();
    const r = spawnSync(
      process.execPath,
      [
        cli,
        'headless',
        'add',
        'a1',
        '--foundry-url',
        'http://f',
        '--world',
        'w',
        '--user',
        'u',
        '--password',
        'zzz-secret',
        '--db',
        db,
      ],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(r.status).toBe(2);
    expect(r.stderr).not.toContain('zzz-secret');
  });

  it.each([
    [['--password', 'zzz-secret']],
    [['--owner', 'zzz-secret']],
    [['--foundry-url', 'http://zzz-secret']],
    [['headless', 'list', '--owner', 'zzz-secret']],
    [['headless', 'remove', 'a1', '--password', 'zzz-secret']],
  ])('refuses %j outside headless add with exit 2 and no echo', (args) => {
    const db = freshDb();
    const r = spawnSync(process.execPath, [cli, ...args, '--db', db], {
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('goes with headless add');
    expect(r.stderr).not.toContain('zzz-secret');
  });
});
