import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './gateway.js';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = [...walk(join(REPO_ROOT, 'e2e')), ...walk(join(REPO_ROOT, 'scripts'))].filter(
  (p) => !p.endsWith('.test.ts'),
);

// The conformance runner (tasks 40, 101) drives MCP Inspector by design; exempt only these files.
const INSPECTOR_ALLOWLIST = [
  'scripts/conformance.sh',
  'scripts/lib/inspector-retry.sh',
  'scripts/release.mjs',
  'scripts/test/conformance-retry.test.mjs',
  'scripts/test/release.test.mjs',
  'scripts/test/docker-release.test.mjs',
];

describe('harness source hygiene', () => {
  it('has sources to scan', () => expect(sources.length).toBeGreaterThan(10));

  it('never stops processes by name', () => {
    const banned = [
      ['pk', 'ill'],
      ['kill', 'all'],
      ['pg', 'rep'],
    ].map((p) => p.join(''));
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      for (const b of banned) expect(text.includes(b), `${f} mentions ${b}`).toBe(false);
    }
  });

  it('signals only the recorded child PID', () => {
    const uses = sources.filter((f) => /process\.kill\(/.test(readFileSync(f, 'utf8')));
    expect(uses.map((f) => f.slice(REPO_ROOT.length))).toEqual(['/e2e/lib/gateway.ts']);
  });

  it('never types into the pairing code field', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      expect(/(fill|type|press|pressSequentially)\([^)]*pairingCode/.test(text), f).toBe(false);
      expect(/\.(fill|type|pressSequentially)\([^)]*name="code"/.test(text), f).toBe(false);
    }
  });

  it('has every Inspector allowlist entry on disk', () => {
    for (const rel of INSPECTOR_ALLOWLIST) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} is allowlisted but missing`).toBe(true);
    }
  });

  it('does not mention MCP Inspector outside the conformance runner', () => {
    for (const f of sources) {
      if (INSPECTOR_ALLOWLIST.includes(f.slice(REPO_ROOT.length + 1))) continue;
      const text = readFileSync(f, 'utf8');
      expect(text.toLowerCase().includes('inspector'), f).toBe(false);
    }
  });
});
