import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../../src/config/index.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function file(body: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'ag-pw-'));
  dirs.push(dir);
  const path = join(dir, 'c.json');
  writeFileSync(path, JSON.stringify(body));
  chmodSync(path, 0o600);
  return path;
}

const thrown = (fn: () => unknown): ConfigError => {
  try {
    fn();
  } catch (e) {
    return e as ConfigError;
  }
  throw new Error('did not throw');
};

describe('stored agent passwords', () => {
  it('read the nested file key and the env form, env winning', () => {
    const configPath = file({ headless: { a1: { password: 'f1' }, 'b-2': { password: 'f2' } } });
    const c = loadConfig({ configPath, env: { AGENT_GATEWAY_HEADLESS_B_2_PASSWORD: 'e2' } });
    expect(c.headlessAgentPasswords).toEqual({ a1: 'f1', 'b-2': 'e2' });
  });

  it('are empty when no key is present, and the flag/env agent password is not one of them', () => {
    expect(loadConfig({ env: {} }).headlessAgentPasswords).toEqual({});
    expect(
      loadConfig({
        env: {
          AGENT_GATEWAY_HEADLESS_FOUNDRY_URL: 'http://f:1',
          AGENT_GATEWAY_HEADLESS_WORLD: 'w',
          AGENT_GATEWAY_HEADLESS_USER: 'u',
          AGENT_GATEWAY_HEADLESS_PASSWORD: 'pw',
        },
      }).headlessAgentPasswords,
    ).toEqual({});
  });

  it('refuse an empty password in the file, naming the key and no value', () => {
    const configPath = file({ headless: { a1: { password: '' } } });
    const err = thrown(() => loadConfig({ configPath, env: {} }));
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain('headless.a1.password');
  });

  it('refuse an empty password in the environment, naming the variable', () => {
    const err = thrown(() => loadConfig({ env: { AGENT_GATEWAY_HEADLESS_A1_PASSWORD: '' } }));
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain('AGENT_GATEWAY_HEADLESS_A1_PASSWORD');
    expect(err.message).toContain('a1'.toUpperCase());
  });

  it('refuse a bad name or shape in the file without echoing a password', () => {
    const bad = thrown(() =>
      loadConfig({ configPath: file({ headless: { 'Bad Name': { password: 'secret-pw' } } }) }),
    );
    expect(bad.message).not.toContain('secret-pw');
    expect(() => loadConfig({ configPath: file({ headless: 'x' }) })).toThrow(ConfigError);
    expect(() => loadConfig({ configPath: file({ headless: { a1: { password: 5 } } }) })).toThrow(
      /headless\.a1\.password/,
    );
  });

  it('still refuses an empty headlessPassword beside the other three flag/env settings', () => {
    const err = thrown(() =>
      loadConfig({
        env: {},
        flags: {
          headlessFoundryUrl: 'http://f:1',
          headlessWorld: 'w',
          headlessUser: 'u',
        },
      }),
    );
    expect(err.exitCode).toBe(2);
    expect(err.message).toContain('together');
  });
});
