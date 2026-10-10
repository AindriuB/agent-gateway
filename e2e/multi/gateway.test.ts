import { describe, expect, it } from 'vitest';
import { loadE2eConfig, e2ePaths } from '../lib/config.js';
import { gatewayArgs } from '../lib/gateway.js';
import { multiGatewayArgs, pidAlive } from './gateway.js';

const config = loadE2eConfig({ env: {} });
const paths = e2ePaths('/home/u');

describe('multiGatewayArgs', () => {
  it('matches the harness arguments when a user is given', () => {
    expect(multiGatewayArgs(config, paths, 'player1')).toEqual(
      gatewayArgs(config, paths, 'player1'),
    );
  });
  it('omits --user but keeps --world when none is given', () => {
    const args = multiGatewayArgs(config, paths, undefined);
    expect(args).not.toContain('--user');
    expect(args.slice(args.indexOf('--world'), args.indexOf('--world') + 2)).toEqual([
      '--world',
      'test-world',
    ]);
  });
});

describe('pidAlive', () => {
  it('sees this process and not an absurd PID', async () => {
    expect(await pidAlive(process.pid)).toBe(true);
    expect(await pidAlive(2 ** 22 + 12345)).toBe(false);
  });
});
