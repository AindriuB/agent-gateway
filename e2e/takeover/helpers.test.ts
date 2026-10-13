import { describe, expect, it } from 'vitest';
import { parseBearerToken, parseConnectedCount, takeoverArgs } from './helpers.js';

describe('takeoverArgs', () => {
  it('turns HTTP on at the given port', () => {
    expect(takeoverArgs(17431)).toEqual(['--http', '--http-port', '17431']);
  });
  it.each([7420, 7421, 0, 80, 70000, 1.5])('refuses %s', (port) => {
    expect(() => takeoverArgs(port)).toThrow();
  });
});

describe('parseBearerToken', () => {
  it('reads the token the gateway prints once', () => {
    const err = 'x\nHTTP bearer token (shown once, stored hashed): abc123\nMCP HTTP at http://x\n';
    expect(parseBearerToken(err)).toBe('abc123');
    expect(parseBearerToken('MCP HTTP at http://127.0.0.1:1/mcp')).toBeUndefined();
  });
});

describe('parseConnectedCount', () => {
  it('reads the connected count from the status page', () => {
    expect(parseConnectedCount('<h2>Connected (1)</h2><ul></ul>')).toBe(1);
    expect(parseConnectedCount('<h2>Connected (0)</h2>')).toBe(0);
    expect(parseConnectedCount('not found')).toBeUndefined();
  });
});
