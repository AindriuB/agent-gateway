import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('does not use MCP Inspector or write inside the repo', () => {
    for (const f of sources) {
      const text = readFileSync(f, 'utf8');
      expect(text.toLowerCase().includes('inspector'), f).toBe(false);
    }
  });
});
