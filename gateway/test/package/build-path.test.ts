import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const gateway = fileURLToPath(new URL('../..', import.meta.url));
const modules = fileURLToPath(new URL('../../../node_modules', import.meta.url));

describe('gateway build', () => {
  it('builds from a checkout whose path contains a space', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fag-build-'));
    try {
      const root = join(tmp, 'agent gateway');
      const copy = join(root, 'gateway');
      mkdirSync(copy, { recursive: true });
      symlinkSync(modules, join(root, 'node_modules'), 'dir');
      for (const f of ['build.mjs', 'package.json', 'src']) {
        cpSync(join(gateway, f), join(copy, f), { recursive: true });
      }
      execFileSync(process.execPath, ['build.mjs'], { cwd: copy, stdio: 'pipe' });
      expect(existsSync(join(copy, 'dist', 'bin', 'cli.js'))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
