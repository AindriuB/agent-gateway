import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
const run = (args: string[]) => {
  const d = mkdtempSync(join(tmpdir(), 'ag-links-'));
  try {
    return spawnSync(process.execPath, [cli, ...args, '--db', join(d, 'g.db')], {
      encoding: 'utf8',
      env: { ...process.env, AGENT_GATEWAY_PRIVACY_URL: '', AGENT_GATEWAY_SOURCE_URL: '' },
      timeout: 15_000,
    });
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
};

describe('consent link flags', () => {
  it.each(['--privacy-url', '--source-url'])(
    '%s http://evil.example exits 2 with the reason',
    (f) => {
      const r = run([f, 'http://evil.example']);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(`Invalid ${f}`);
      expect(r.stderr).toContain('loopback');
    },
  );

  it('--help lists both flags with their env keys', () => {
    const r = run(['--help']);
    expect(r.stdout).toContain('--privacy-url');
    expect(r.stdout).toContain('AGENT_GATEWAY_PRIVACY_URL');
    expect(r.stdout).toContain('--source-url');
    expect(r.stdout).toContain('AGENT_GATEWAY_SOURCE_URL');
  });
});
