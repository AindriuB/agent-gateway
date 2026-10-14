import { describe, expect, it } from 'vitest';
import { e2ePaths, loadE2eConfig } from './config.js';
import { GATEWAY_CLI, GatewayProcess, gatewayArgs, parsePairingCode } from './gateway.js';

describe('gatewayArgs', () => {
  it('builds exactly the documented command line', () => {
    const config = loadE2eConfig({ env: { FOUNDRY_URL: 'https://foundry.local/some/path' } });
    const paths = e2ePaths('/home/u');
    expect(gatewayArgs(config, paths, 'player1')).toEqual([
      GATEWAY_CLI,
      '--link-port',
      '7429',
      '--db',
      '/home/u/.config/agent-gateway/e2e/gateway.db',
      '--allow-origin',
      'https://foundry.local',
      '--world',
      'test-world',
      '--user',
      'player1',
    ]);
    expect(GATEWAY_CLI.endsWith('gateway/dist/bin/cli.js')).toBe(true);
  });
});

describe('parsePairingCode', () => {
  it('reads the code from the status line', () => {
    const err = 'x\nPairing code: ABC-123 (expires in 5 min)\nLink URL: ws://localhost:7429\n';
    expect(parsePairingCode(err)).toBe('ABC-123');
    expect(parsePairingCode('nothing yet')).toBeUndefined();
  });
});

describe('gatewayArgs without a user', () => {
  it('omits --user but keeps --world', () => {
    const config = loadE2eConfig({ env: {} });
    const paths = e2ePaths('/home/u');
    const args = gatewayArgs(config, paths, undefined);
    expect(args).not.toContain('--user');
    expect(args).toContain('--world');
    expect(gatewayArgs(config, paths, 'player1').slice(-2)).toEqual(['--user', 'player1']);
  });
});

describe('GatewayProcess without a client', () => {
  const make = () => new GatewayProcess(loadE2eConfig({ env: {} }), e2ePaths('/home/u'), undefined);

  it('call() before connectClient() rejects instead of hanging', async () => {
    await expect(make().call('world_info')).rejects.toThrow(/gateway not started/);
  });

  it('stop() on a gateway that never started is safe', async () => {
    const gw = make();
    await expect(gw.stop()).resolves.toBeUndefined();
    expect(gw.childPid).toBeNull();
  });

  it('connectClient() without a deferred start rejects', async () => {
    await expect(make().connectClient()).rejects.toThrow(/connectClient\(\) needs/);
  });
});
