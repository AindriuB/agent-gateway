import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, normalizePublicUrl } from '../../src/config/index.js';

function file(body: object): string {
  const p = join(mkdtempSync(join(tmpdir(), 'agw-')), 'config.json');
  writeFileSync(p, JSON.stringify(body));
  chmodSync(p, 0o600);
  return p;
}

describe('exposure settings', () => {
  it('defaults to local, loopback and off', () => {
    expect(loadConfig({ env: {} })).toMatchObject({
      http: false,
      allowOrigin: [],
      publicUrl: '',
      serverMode: false,
      linkHost: '127.0.0.1',
      httpHost: '127.0.0.1',
      trustProxy: false,
    });
  });

  it('reads every setting from its env key', () => {
    const c = loadConfig({
      env: {
        AGENT_GATEWAY_PUBLIC_URL: 'https://gw.example.com/',
        AGENT_GATEWAY_SERVER_MODE: '1',
        AGENT_GATEWAY_LINK_HOST: '0.0.0.0',
        AGENT_GATEWAY_HTTP_HOST: '0.0.0.0',
        AGENT_GATEWAY_TRUST_PROXY: 'true',
        AGENT_GATEWAY_HTTP: '1',
        AGENT_GATEWAY_ALLOW_ORIGIN: 'https://a.example, https://b.example',
      },
    });
    expect(c).toMatchObject({
      publicUrl: 'https://gw.example.com',
      serverMode: true,
      linkHost: '0.0.0.0',
      httpHost: '0.0.0.0',
      trustProxy: true,
      http: true,
      allowOrigin: ['https://a.example', 'https://b.example'],
    });
  });

  it('reads every setting from the config file, and flags beat env beat file', () => {
    const configPath = file({
      publicUrl: 'https://file.example',
      serverMode: true,
      trustProxy: true,
      http: true,
      allowOrigin: ['https://a.example'],
      httpHost: '0.0.0.0',
      linkHost: '0.0.0.0',
    });
    expect(loadConfig({ configPath, env: {} })).toMatchObject({
      publicUrl: 'https://file.example',
      serverMode: true,
      trustProxy: true,
      http: true,
      allowOrigin: ['https://a.example'],
      httpHost: '0.0.0.0',
      linkHost: '0.0.0.0',
    });
    const env = { AGENT_GATEWAY_PUBLIC_URL: 'https://env.example' };
    expect(loadConfig({ configPath, env }).publicUrl).toBe('https://env.example');
    expect(
      loadConfig({ configPath, env, flags: { publicUrl: 'https://flag.example' } }).publicUrl,
    ).toBe('https://flag.example');
  });

  it('reads flags', () => {
    const c = loadConfig({
      env: {},
      flags: {
        publicUrl: 'https://gw.example.com',
        serverMode: true,
        trustProxy: true,
        http: true,
        allowOrigin: ['https://a.example', 'https://b.example'],
        linkHost: '0.0.0.0',
        httpHost: '::',
      },
    });
    expect(c.allowOrigin).toHaveLength(2);
    expect(c.httpHost).toBe('::');
  });
});

describe('--public-url', () => {
  it('drops a trailing slash', () => {
    expect(normalizePublicUrl('https://gw.example.com/')).toBe('https://gw.example.com');
    expect(normalizePublicUrl('https://gw.example.com:8443')).toBe('https://gw.example.com:8443');
  });

  it('allows http only on a loopback host, with a usage exit code', () => {
    expect(normalizePublicUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizePublicUrl('http://localhost')).toBe('http://localhost');
    expect(() => normalizePublicUrl('http://gw.example.com')).toThrow(/loopback/);
  });

  it.each([
    'not a url',
    'ftp://gw.example.com',
    'http://gw.example.com',
    'https://gw.example.com/mcp',
    'https://gw.example.com/?a=1',
    'https://gw.example.com/#x',
    'https://user:pw@gw.example.com',
  ])('refuses %s with exit code 2', (value) => {
    try {
      loadConfig({ env: {}, flags: { publicUrl: value } });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).exitCode).toBe(2);
      expect((err as ConfigError).message).toContain('--public-url');
    }
  });
});

describe('bind addresses', () => {
  it.each([
    ['httpHost', '--http-host'],
    ['linkHost', '--link-host'],
  ])('refuses a non-loopback %s without a public URL, naming the flag', (key, flag) => {
    for (const host of ['0.0.0.0', '192.168.1.5', 'localhost']) {
      expect(() => loadConfig({ env: {}, flags: { [key]: host } })).toThrow(flag);
    }
    const c = loadConfig({
      env: {},
      flags: { [key]: '0.0.0.0', publicUrl: 'https://gw.example.com' },
    });
    expect(c[key as 'httpHost']).toBe('0.0.0.0');
  });
});
