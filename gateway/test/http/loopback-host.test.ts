import { describe, expect, it } from 'vitest';
import { loopbackAuthority } from '../../src/http/client-key.js';
import { loadConfig } from '../../src/config/index.js';

/** Every literal the loopback Host check and the bind check must agree on. */
const LITERALS = [
  '127.0.0.1',
  '127.0.0.5',
  '::1',
  '0:0:0:0:0:0:0:1',
  '::ffff:127.0.0.1',
  '::ffff:7f00:1',
  '::ffff:10.0.0.1',
  '::2',
  '10.0.0.1',
  '203.0.113.9',
  '2001:db8::1',
  '0.0.0.0',
  '::',
];

describe('loopback Host check agrees with the bind check', () => {
  it.each(LITERALS)('%s', (lit) => {
    const bindOk = (() => {
      try {
        loadConfig({ env: {}, flags: { linkHost: lit } });
        return true;
      } catch {
        return false;
      }
    })();
    const bracketed = lit.includes(':') ? `[${lit}]` : lit;
    expect(loopbackAuthority(`${bracketed}:7420`) !== undefined).toBe(bindOk);
    expect(loopbackAuthority(bracketed) !== undefined).toBe(bindOk);
  });

  it('keeps localhost and rejects malformed authorities', () => {
    expect(loopbackAuthority('localhost:7420')?.port).toBe('7420');
    expect(loopbackAuthority('evil.example')).toBeUndefined();
    expect(loopbackAuthority('[::1')).toBeUndefined();
    expect(loopbackAuthority('[::1]x')).toBeUndefined();
    expect(loopbackAuthority('')).toBeUndefined();
    expect(loopbackAuthority(undefined)).toBeUndefined();
  });
});
