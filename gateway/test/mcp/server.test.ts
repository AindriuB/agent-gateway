import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('cli', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  const freePort = (): Promise<number> =>
    new Promise((resolve) => {
      const s = createNetServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address() as { port: number };
        s.close(() => resolve(port));
      });
    });
  it('writes only JSON-RPC to stdout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ag-mcp-cli-'));
    const child = spawn(
      process.execPath,
      [cli, '--link-port', String(await freePort()), '--db', join(dir, 'g.db')],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await new Promise((r) => setTimeout(r, 1500));
    child.kill();
    await new Promise((r) => child.once('close', r));
    rmSync(dir, { recursive: true, force: true });
    const lines = out.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(JSON.parse(l).jsonrpc).toBe('2.0');
  });
  it('exits 2 on unknown flags', async () => {
    const child = spawn(process.execPath, [cli, '--bogus'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const code = await new Promise((r) => child.on('close', r));
    expect(code).toBe(2);
    expect(err).toContain('Usage');
  });
});
