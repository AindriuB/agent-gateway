import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/index.js';

const CASES = [
  ['--privacy-url', 'privacyUrl', 'AGENT_GATEWAY_PRIVACY_URL'],
  ['--source-url', 'sourceUrl', 'AGENT_GATEWAY_SOURCE_URL'],
] as const;

describe.each(CASES)('%s', (flag, key, envKey) => {
  it('is unset by default and set by flag, env and the config file with the usual precedence', () => {
    expect(loadConfig({ env: {} })[key]).toBe('');
    expect(loadConfig({ env: {}, flags: { [key]: 'https://x.example/a#b' } })[key]).toBe(
      'https://x.example/a#b',
    );
    expect(loadConfig({ env: { [envKey]: 'https://env.example/p' } })[key]).toBe(
      'https://env.example/p',
    );
    expect(
      loadConfig({
        env: { [envKey]: 'https://env.example/p' },
        flags: { [key]: 'https://flag.example/p' },
      })[key],
    ).toBe('https://flag.example/p');
  });

  it('takes the config file, then env over it, then the flag over both', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'agw-')), 'config.json');
    writeFileSync(p, JSON.stringify({ [key]: 'https://file.example/p' }));
    chmodSync(p, 0o600);
    const env = { [envKey]: 'https://env.example/p' };
    expect(loadConfig({ configPath: p, env: {} })[key]).toBe('https://file.example/p');
    expect(loadConfig({ configPath: p, env })[key]).toBe('https://env.example/p');
    expect(
      loadConfig({ configPath: p, env, flags: { [key]: 'https://flag.example/p' } })[key],
    ).toBe('https://flag.example/p');
  });

  it('accepts loopback http', () => {
    expect(loadConfig({ env: {}, flags: { [key]: 'http://127.0.0.1:8080/p' } })[key]).toBe(
      'http://127.0.0.1:8080/p',
    );
  });

  it.each([
    'http://evil.example',
    'ftp://x',
    'javascript:alert(1)',
    'https://u:p@x.example',
    'not a url',
    `https://x.example/${'a'.repeat(2049)}`,
    `https://x.example/${'"'.repeat(2000)}`,
  ])('refuses %s with exit code 2', (value) => {
    try {
      loadConfig({ env: {}, flags: { [key]: value } });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).exitCode).toBe(2);
      expect((err as ConfigError).message).toContain(`Invalid ${flag}`);
    }
  });
});
