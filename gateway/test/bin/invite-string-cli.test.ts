import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openStore } from '../../src/store/index.js';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkDb(): string {
  const d = mkdtempSync(join(tmpdir(), 'ag-invstr-'));
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
function run(db: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, '--db', db, ...args], {
      env: { ...process.env, AGENT_GATEWAY_DB: '', AGENT_GATEWAY_PUBLIC_URL: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
const invites = (db: string) => {
  const s = openStore(db);
  try {
    return s.invites.list();
  } finally {
    s.close();
  }
};
const CODE = '[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}';
const codeOf = (stdout: string) => stdout.trim().split('#')[1] ?? stdout.trim();

describe('--invite one-paste string', () => {
  it('prints wss://host/link#CODE from --public-url, and the code never reaches stderr', async () => {
    const db = mkDb();
    const r = await run(db, ['--invite', 'w', 'u', '--public-url', 'https://gw.example.com']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^wss://gw\\.example\\.com/link#${CODE}\\n$`));
    expect(r.stderr).not.toContain(codeOf(r.stdout));
    expect(r.stderr).toMatch(/older module enter only the part after #/);
    expect(r.stderr).toMatch(/world w, user u/);
  });

  it('takes the address from AGENT_GATEWAY_PUBLIC_URL, and the flag wins over it', async () => {
    const db = mkDb();
    const env = { AGENT_GATEWAY_PUBLIC_URL: 'https://env.example.com' };
    const a = await run(db, ['--invite', 'w', 'u'], env);
    expect(a.stdout).toMatch(new RegExp(`^wss://env\\.example\\.com/link#${CODE}\\n$`));
    const b = await run(db, ['--invite', 'w', 'u2', '--public-url', 'https://flag.example.com'], env);
    expect(b.stdout).toMatch(new RegExp(`^wss://flag\\.example\\.com/link#${CODE}\\n$`));
    expect(a.stderr + b.stderr).not.toContain(codeOf(a.stdout));
    expect(a.stderr + b.stderr).not.toContain(codeOf(b.stdout));
  });

  it('maps a loopback http public URL to ws', async () => {
    const r = await run(mkDb(), ['--invite', 'w', 'u', '--public-url', 'http://localhost:8080']);
    expect(r.stdout).toMatch(new RegExp(`^ws://localhost:8080/link#${CODE}\\n$`));
  });

  it.each(['http://gw.example.com', 'https://gw.example.com/x'])(
    'refuses %s with exit 2 and creates no invite',
    async (bad) => {
      const db = mkDb();
      const r = await run(db, ['--invite', 'w', 'u', '--public-url', bad]);
      expect(r.status).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('Invalid --public-url');
      expect(invites(db)).toHaveLength(0);
    },
  );

  it('prints the bare code with no public URL, and no older-module line', async () => {
    const r = await run(mkDb(), ['--invite', 'w', 'u']);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`^${CODE}\\n$`));
    expect(r.stderr).not.toContain('older module');
    expect(r.stderr).not.toContain(r.stdout.trim());
  });

  it('documents the one-paste string in --help', async () => {
    const r = await run(mkDb(), ['--help']);
    expect(r.stdout + r.stderr).toMatch(/wss:\/\/<host>\/link#<CODE>/);
    expect(r.stdout + r.stderr).toMatch(/AGENT_GATEWAY_PUBLIC_URL/);
  });
});
