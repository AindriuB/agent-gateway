import { describe, expect, it } from 'vitest';
import { ConfigError, e2ePaths, loadE2eConfig, parseEnvFile, profileDir } from './config.js';

describe('loadE2eConfig', () => {
  it('uses the documented defaults', () => {
    const c = loadE2eConfig({ env: {} });
    expect(c).toMatchObject({
      foundryUrl: 'https://foundry.local',
      foundryOrigin: 'https://foundry.local',
      world: 'test-world',
      gmUser: 'dev-gm',
      playerUser: 'player1',
      player2User: 'player2',
      linkPort: 7429,
      password: undefined,
      v13Url: undefined,
    });
  });

  it('falls back to test.env and lets the environment win', () => {
    const file = [
      '# comment',
      'FOUNDRY_URL=https://file.example:8443/',
      'FOUNDRY_GM_USER="gm-from-file"',
      'export FOUNDRY_WORLD=w1',
      'FOUNDRY_PASSWORD=from-file',
      'AGENT_GATEWAY_E2E_V13_URL=https://v13.local',
    ].join('\n');
    const c = loadE2eConfig({ env: { FOUNDRY_WORLD: 'w2' }, testEnvText: file });
    expect(c.foundryUrl).toBe('https://file.example:8443');
    expect(c.foundryOrigin).toBe('https://file.example:8443');
    expect(c.gmUser).toBe('gm-from-file');
    expect(c.world).toBe('w2');
    expect(c.password).toBe('from-file');
    expect(c.v13Url).toBe('https://v13.local');
  });

  it('treats empty values as unset', () => {
    expect(loadE2eConfig({ env: { FOUNDRY_WORLD: '' } }).world).toBe('test-world');
  });

  it('refuses the dev link port and bad ports', () => {
    expect(() => loadE2eConfig({ env: { AGENT_GATEWAY_E2E_LINK_PORT: '7420' } })).toThrow(
      ConfigError,
    );
    expect(() => loadE2eConfig({ env: { AGENT_GATEWAY_E2E_LINK_PORT: 'x' } })).toThrow(ConfigError);
    expect(loadE2eConfig({ env: { AGENT_GATEWAY_E2E_LINK_PORT: '7431' } }).linkPort).toBe(7431);
  });

  it('rejects a FOUNDRY_URL that is not a URL', () => {
    expect(() => loadE2eConfig({ env: { FOUNDRY_URL: 'nope' } })).toThrow(ConfigError);
  });

  it('defaults the pairing wait to 5 minutes and the connect wait under 45 s', () => {
    const c = loadE2eConfig({ env: {} });
    expect(c.pairTimeoutMs).toBe(300_000);
    expect(c.connectTimeoutMs).toBeLessThan(45_000);
    expect(loadE2eConfig({ env: { AGENT_GATEWAY_E2E_PAIR_TIMEOUT_S: '10' } }).pairTimeoutMs).toBe(
      10_000,
    );
  });
});

describe('parseEnvFile', () => {
  it('ignores blanks, comments and malformed lines', () => {
    expect(parseEnvFile('\n# x\nA=1\nbad line\nB = two \n')).toEqual({ A: '1', B: 'two' });
  });
});

describe('paths', () => {
  it('keeps all state under ~/.config/agent-gateway/e2e', () => {
    const p = e2ePaths('/home/u');
    expect(p.stateDir).toBe('/home/u/.config/agent-gateway/e2e');
    expect(p.db).toBe('/home/u/.config/agent-gateway/e2e/gateway.db');
    expect(profileDir(p, 'player1')).toBe('/home/u/.config/agent-gateway/e2e/profiles/player1');
    expect(p.testEnv).toBe('/home/u/.config/agent-gateway/test.env');
  });

  it('keeps a hostile user name inside profiles/', () => {
    const p = e2ePaths('/home/u');
    expect(profileDir(p, '../../x')).toBe(`${p.profilesDir}/.._.._x`);
  });
});
