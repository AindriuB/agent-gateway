import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const env = {
  AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: 'http://foundry.local:30000/',
  AGENT_GATEWAY_HEADLESS_WORLD: 'test-world',
  AGENT_GATEWAY_HEADLESS_USER: 'abc123',
  AGENT_GATEWAY_HEADLESS_PASSWORD: 'pw',
};

describe('headless settings', () => {
  it('are off by default', () => {
    expect(loadConfig({ env: {} })).toMatchObject({ headlessFoundryUrl: '', headlessUser: '' });
  });

  it('read from the environment and normalize the URL', () => {
    expect(loadConfig({ env })).toMatchObject({
      headlessFoundryUrl: 'http://foundry.local:30000',
      headlessWorld: 'test-world',
      headlessUser: 'abc123',
      headlessPassword: 'pw',
    });
  });

  it('take the URL, world and user from flags but the password only from env or the file', () => {
    const { AGENT_GATEWAY_HEADLESS_PASSWORD: pw, ...rest } = env;
    expect(() => loadConfig({ env: rest })).toThrow(ConfigError);
    const dir = mkdtempSync(join(tmpdir(), 'ag-cfg-'));
    dirs.push(dir);
    const file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ headlessPassword: pw }));
    chmodSync(file, 0o600);
    expect(
      loadConfig({
        env: {},
        configPath: file,
        flags: {
          headlessFoundryUrl: env.AGENT_GATEWAY_HEADLESS_FOUNDRY_URL,
          headlessWorld: 'w',
          headlessUser: 'u',
        },
      }).headlessPassword,
    ).toBe('pw');
  });

  it('are all-or-none', () => {
    expect(() => loadConfig({ env: { AGENT_GATEWAY_HEADLESS_WORLD: 'w' } })).toThrow(/together/);
  });

  it('refuse a URL with credentials', () => {
    expect(() =>
      loadConfig({
        env: { ...env, AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: 'http://a:b@foundry.local' },
      }),
    ).toThrow(/credentials/);
  });
});
