import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, IGNORED_ROLE_MESSAGE, loadConfig } from '../../src/config/index.js';

/** Type-checks `code` against the real sources with tsc; returns tsc's diagnostics ('' if clean). */
function typeCheck(code: string): string {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const d = mkdtempSync(join(tmpdir(), 'ag-types-'));
  try {
    writeFileSync(join(d, 'package.json'), '{"type":"module"}');
    writeFileSync(join(d, 'check.ts'), code.replaceAll('SRC', join(root, 'gateway/src')));
    writeFileSync(
      join(d, 'tsconfig.json'),
      JSON.stringify({
        extends: join(root, 'tsconfig.base.json'),
        compilerOptions: {
          noEmit: true,
          typeRoots: [join(root, 'node_modules/@types')],
          types: ['node'],
        },
        files: ['check.ts'],
      }),
    );
    const r = spawnSync(join(root, 'node_modules/.bin/tsc'), ['-p', d], { encoding: 'utf8' });
    return r.stdout + r.stderr;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

function tmpFile(mode: number, body = '{"linkPort": 8000}'): string {
  const p = join(mkdtempSync(join(tmpdir(), 'agw-')), 'config.json');
  writeFileSync(p, body);
  chmodSync(p, mode);
  return p;
}

describe('loadConfig', () => {
  it('defaults', () => {
    expect(loadConfig({ env: {} }).linkPort).toBe(7420);
  });
  it('file < env < flags', () => {
    const configPath = tmpFile(0o600);
    expect(loadConfig({ configPath, env: {} }).linkPort).toBe(8000);
    expect(loadConfig({ configPath, env: { AGENT_GATEWAY_LINK_PORT: '9000' } }).linkPort).toBe(
      9000,
    );
    expect(
      loadConfig({
        configPath,
        env: { AGENT_GATEWAY_LINK_PORT: '9000' },
        flags: { linkPort: '9100' },
      }).linkPort,
    ).toBe(9100);
  });
  it('refuses group/other readable files naming path and chmod 600', () => {
    const configPath = tmpFile(0o644);
    expect(() => loadConfig({ configPath, env: {} })).toThrow(ConfigError);
    expect(() => loadConfig({ configPath, env: {} })).toThrow(
      new RegExp(`${configPath}.*chmod 600`),
    );
  });
  it('rejects invalid values', () => {
    expect(() => loadConfig({ env: { AGENT_GATEWAY_LINK_PORT: 'abc' } })).toThrow(ConfigError);
  });
  it('ignores a retired role in the file or the environment, reporting it once', () => {
    const fromFile: string[] = [];
    const a = loadConfig({
      configPath: tmpFile(0o600, '{"role": "gm", "linkPort": 8001}'),
      env: {},
      onIgnored: (m) => fromFile.push(m),
    });
    expect(a.linkPort).toBe(8001);
    expect(a).not.toHaveProperty('role');
    expect(fromFile).toEqual([IGNORED_ROLE_MESSAGE]);
    const fromEnv: string[] = [];
    const b = loadConfig({ env: { AGENT_GATEWAY_ROLE: 'gm' }, onIgnored: (m) => fromEnv.push(m) });
    expect(b).not.toHaveProperty('role');
    expect(fromEnv).toEqual([IGNORED_ROLE_MESSAGE]);
    const both: string[] = [];
    loadConfig({
      configPath: tmpFile(0o600, '{"role": "gm"}'),
      env: { AGENT_GATEWAY_ROLE: 'player' },
      onIgnored: (m) => both.push(m),
    });
    expect(both).toHaveLength(1);
  });
  it('reports nothing when no role is given', () => {
    const seen: string[] = [];
    loadConfig({ env: {}, onIgnored: (m) => seen.push(m) });
    expect(seen).toEqual([]);
  });
  it('has no role key in its type', () => {
    const body = (field: string) => `import type { Config } from 'SRC/config/index.js';
export const c = (x: Config) => x.${field};
`;
    expect(typeCheck(body('linkPort'))).toBe('');
    expect(typeCheck(body('role'))).toMatch(/'role'/);
  }, 30_000);
});
