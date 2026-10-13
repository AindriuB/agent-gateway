import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));

describe('packed gateway contents', () => {
  it('ships only package.json, README.md, LICENSE and dist/', () => {
    const out = execFileSync(
      'npm',
      ['pack', '-w', 'gateway', '--dry-run', '--json', '--ignore-scripts'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const [pack] = JSON.parse(out) as { files: { path: string }[] }[];
    const paths = pack!.files.map((f) => f.path);
    expect(paths).toContain('dist/bin/cli.js');
    for (const p of paths) {
      expect(['package.json', 'README.md', 'LICENSE'].includes(p) || p.startsWith('dist/'), p).toBe(
        true,
      );
    }
    expect(paths.some((p) => p.startsWith('src/') || p.includes('.test.'))).toBe(false);
  }, 120_000);
});
