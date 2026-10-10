import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
  const db = join(mkdtempSync(join(tmpdir(), 'ag-cli-')), 'g.db');
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
    expect(out).toBe('');
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://foundry.test' });
    await new Promise<void>((res, rej) => {
      ws.once('open', () => res());
      ws.once('error', rej);
    });
    ws.close();
  } finally {
    child.kill();
  }
});
