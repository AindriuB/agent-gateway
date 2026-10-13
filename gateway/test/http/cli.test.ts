import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));

describe('--http-host', () => {
  it.each(['0.0.0.0', '192.168.1.5', 'localhost'])('refuses %s with exit 2', (host) => {
    const r = spawnSync(process.execPath, [cli, '--http', '--http-host', host], {
      encoding: 'utf8',
      input: '',
      timeout: 10_000,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('127.0.0.1');
  });
});
