import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
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
const tmpDb = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ag-bin-'));
  dirs.push(d);
  return join(d, 'g.db');
};
const ports = async () => {
  const link = await freePort();
  let http = await freePort();
  while (http === link) http = await freePort();
  return { link, http };
};
const run = (args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    input: '',
    timeout: 15_000,
    env: { ...process.env, ...env },
  });

async function start(args: string[], env: NodeJS.ProcessEnv = {}) {
  const gw = spawn(process.execPath, [cli, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  children.push(gw);
  gw.stdin!.end();
  let err = '';
  let out = '';
  gw.stderr!.on('data', (d: Buffer) => (err += d.toString()));
  gw.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  const exited = new Promise<number | null>((r) => gw.once('exit', (code) => r(code)));
  return { gw, err: () => err, out: () => out, exited };
}

describe('--server-mode', () => {
  it('stays up with stdin closed, serves /status, has no stdio session, and exits 0 on SIGTERM', async () => {
    const p = await ports();
    const g = await start([
      '--server-mode',
      '--db',
      tmpDb(),
      '--link-port',
      String(p.link),
      '--http-port',
      String(p.http),
    ]);
    await until(() => g.err().includes('MCP HTTP at'), 15_000, 'start');
    await new Promise((r) => setTimeout(r, 500));
    expect(g.gw.exitCode).toBeNull();
    const r = await fetch(`http://127.0.0.1:${p.http}/status`);
    expect(r.status).toBe(200);
    expect(g.out()).toBe('');
    g.gw.kill('SIGTERM');
    expect(await g.exited).toBe(0);
  }, 30_000);

  it('reads server mode and the public URL from the environment', async () => {
    const p = await ports();
    const g = await start(
      ['--db', tmpDb(), '--link-port', String(p.link), '--http-port', String(p.http)],
      { AGENT_GATEWAY_SERVER_MODE: '1', AGENT_GATEWAY_PUBLIC_URL: 'https://gw.example.com/' },
    );
    await until(() => g.err().includes('MCP HTTP at'), 15_000, 'start');
    await new Promise((r) => setTimeout(r, 300));
    expect(g.gw.exitCode).toBeNull();
    const r = await fetch(`http://127.0.0.1:${p.http}/status`, {
      headers: { host: 'gw.example.com' },
    });
    expect(r.status).toBe(200);
    expect(g.err()).toContain('HTTP bearer token is off because --public-url is set');
  }, 30_000);
});

describe('bind addresses and public URL', () => {
  it.each(['--http-host', '--link-host'])(
    '%s 0.0.0.0 without --public-url exits 2 naming the flag',
    (flag) => {
      const r = run([flag, '0.0.0.0', '--db', tmpDb()]);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(flag);
    },
  );

  it('binds beyond loopback with --public-url and says TLS belongs to a reverse proxy once', async () => {
    const p = await ports();
    const g = await start([
      '--public-url',
      'https://gw.example.com',
      '--http-host',
      '0.0.0.0',
      '--link-host',
      '0.0.0.0',
      '--db',
      tmpDb(),
      '--link-port',
      String(p.link),
      '--http-port',
      String(p.http),
    ]);
    await until(() => g.err().includes('MCP HTTP at'), 15_000, 'start');
    expect(g.err().match(/TLS must be terminated by a reverse proxy/g)).toHaveLength(1);
    g.gw.stdin!.destroy();
  }, 30_000);

  it.each([
    'nonsense',
    'http://gw.example.com',
    'https://gw.example.com/mcp',
    'https://gw.example.com/?x=1',
    'https://gw.example.com/#f',
  ])('--public-url %s exits 2 with the reason', (url) => {
    const r = run(['--public-url', url, '--db', tmpDb()]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--public-url');
  });

  it('--http-rotate-token with the public URL in the environment exits 2 naming both', () => {
    const r = run(['--http-rotate-token', '--db', tmpDb()], {
      AGENT_GATEWAY_PUBLIC_URL: 'https://gw.example.com',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--http-rotate-token');
    expect(r.stderr).toContain('--public-url');
  });

  it('--http-rotate-token with --public-url exits 2', () => {
    const r = run([
      '--http-rotate-token',
      '--public-url',
      'https://gw.example.com',
      '--db',
      tmpDb(),
    ]);
    expect(r.status).toBe(2);
  });
});
