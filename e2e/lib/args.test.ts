import { describe, expect, it } from 'vitest';
import { ArgError, parseRunArgs, parseSetupArgs, V13_SKIP_MESSAGE } from './args.js';
import { loadE2eConfig } from './config.js';
import { chooseTarget } from './target.js';

describe('parseRunArgs', () => {
  it('defaults to v14 and passes the rest through', () => {
    expect(parseRunArgs([])).toEqual({ foundry: 'v14', rest: [] });
    expect(parseRunArgs(['-t', 'chat'])).toEqual({ foundry: 'v14', rest: ['-t', 'chat'] });
  });
  it('reads --foundry in both forms', () => {
    expect(parseRunArgs(['--foundry', 'v13']).foundry).toBe('v13');
    expect(parseRunArgs(['--foundry=v13']).foundry).toBe('v13');
  });
  it('rejects bad values', () => {
    expect(() => parseRunArgs(['--foundry', 'v12'])).toThrow(ArgError);
    expect(() => parseRunArgs(['--foundry'])).toThrow(ArgError);
  });
});

describe('chooseTarget', () => {
  it('skips v13 when no instance is configured', () => {
    const t = chooseTarget('v13', loadE2eConfig({ env: {} }));
    expect(t).toEqual({ kind: 'skip', message: V13_SKIP_MESSAGE });
    expect(V13_SKIP_MESSAGE).toBe(
      'SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)',
    );
  });
  it('points v13 at its own URL and origin', () => {
    const t = chooseTarget(
      'v13',
      loadE2eConfig({ env: { AGENT_GATEWAY_E2E_V13_URL: 'https://v13.local:8443/' } }),
    );
    expect(t.kind === 'run' && t.config.foundryUrl).toBe('https://v13.local:8443');
    expect(t.kind === 'run' && t.config.foundryOrigin).toBe('https://v13.local:8443');
  });
  it('v14 uses FOUNDRY_URL', () => {
    const t = chooseTarget('v14', loadE2eConfig({ env: { FOUNDRY_URL: 'https://x.test' } }));
    expect(t.kind === 'run' && t.config.foundryUrl).toBe('https://x.test');
  });
});

describe('parseSetupArgs', () => {
  it('parses --player2 and --only', () => {
    expect(parseSetupArgs(['--player2', '--only', 'dev-gm'])).toEqual({
      includePlayer2: true,
      only: ['dev-gm'],
    });
    expect(() => parseSetupArgs(['--x'])).toThrow(ArgError);
  });
});
