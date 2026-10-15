import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';
import { HEADLESS_FLAG_KEY, HEADLESS_LINK_KEY } from '../../src/headless/flag.js';

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

  it('headlessNoSandbox is off by default and reads AGENT_GATEWAY_HEADLESS_NO_SANDBOX', () => {
    expect(loadConfig({ env: {} }).headlessNoSandbox).toBe(false);
    expect(loadConfig({ env: { AGENT_GATEWAY_HEADLESS_NO_SANDBOX: '1' } }).headlessNoSandbox).toBe(
      true,
    );
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

it('headless flag keys match the module copies', () => {
  const bridge = readFileSync(join(__dirname, '../../../module/src/link/bridge.ts'), 'utf8');
  const runtime = readFileSync(join(__dirname, '../../../module/src/link/runtime.ts'), 'utf8');
  expect(bridge).toContain(`HEADLESS_FLAG_KEY = '${HEADLESS_FLAG_KEY}'`);
  expect(runtime).toContain(`HEADLESS_LINK_KEY = '${HEADLESS_LINK_KEY}'`);
});

describe('headless URL errors', () => {
  it('never echo a username, password, path or query from the URL', () => {
    for (const url of [
      'https://agent:hunter2@foundry.example',
      'https://foundry.example/?token=s3cret',
      'ftp://foundry.example/s3cret',
      'not a url s3cret',
    ]) {
      let message = '';
      try {
        loadConfig({
          env: { ...env, AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: url },
        });
      } catch (err) {
        message = (err as ConfigError).message;
      }
      expect(message).toContain('--headless-foundry-url');
      for (const secret of ['agent', 'hunter2', 's3cret', 'foundry.example'])
        expect(message).not.toContain(secret);
    }
  });
});
