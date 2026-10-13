import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import WebSocket from 'ws';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

it('prints the pairing code and link URL to stderr and accepts link connections', async () => {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'ag-cli-'));
  const db = join(dir, 'g.db');
  const child = spawn(
    process.execPath,
    [cli, '--link-port', String(port), '--db', db, '--allow-origin', 'http://foundry.test'],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  try {
    let err = '';
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const start = Date.now();
    while (!/Link URL:/.test(err)) {
      if (Date.now() - start > 5000) throw new Error(`no startup output: ${err}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(err).toMatch(/Pairing code: [A-Z2-9]{4}-[A-Z2-9]{4} \(expires in 10 min\)/);
    expect(err).toContain(`ws://localhost:${port}`);
    // Nothing is written to stdout before the client speaks: the notice waits for the handshake.
    expect(out).toBe('');
    const rpc = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const waited = Date.now();
    while (!out.includes('notifications/message')) {
      if (Date.now() - waited > 5000) throw new Error(`no pairing notice: ${out}`);
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(out).toContain('Pairing code: ');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://foundry.test' });
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    ws.close();
  } finally {
    child.kill();
    await new Promise((r) => child.once('close', r));
    rmSync(dir, { recursive: true, force: true });
  }
});
