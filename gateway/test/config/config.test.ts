import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';

function tmpFile(mode: number, body = '{"linkPort": 8000, "role": "gm"}'): string {
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
});
