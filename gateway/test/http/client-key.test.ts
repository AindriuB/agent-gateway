import { describe, expect, it } from 'vitest';
import { clientKey, isLoopbackAddress, normalizeAddress } from '../../src/http/client-key.js';

describe('client key', () => {
  it('keys IPv6 addresses by /64 prefix', () => {
    expect(normalizeAddress('2001:db8:1:2::a')).toBe(normalizeAddress('2001:db8:1:2::b'));
    expect(normalizeAddress('2001:db8:1:3::a')).not.toBe(normalizeAddress('2001:db8:1:2::a'));
  });

  it('keys an IPv4-mapped address as the IPv4 address', () => {
    expect(normalizeAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(normalizeAddress('::ffff:cb00:7109')).toBe('203.0.113.9');
    expect(clientKey('::ffff:203.0.113.9', undefined, false)).toBe(
      clientKey('203.0.113.9', undefined, false),
    );
  });

  it('knows loopback in every spelling', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1', '0:0:0:0:0:0:0:1'])
      expect(isLoopbackAddress(a)).toBe(true);
    for (const a of ['203.0.113.9', '2001:db8::1', '::ffff:203.0.113.9', undefined, 'nonsense'])
      expect(isLoopbackAddress(a)).toBe(false);
  });

  it('ignores X-Forwarded-For without --trust-proxy', () => {
    expect(clientKey('127.0.0.1', '203.0.113.9', false)).toBe('127.0.0.1');
  });

  it('uses the right-most X-Forwarded-For entry from a loopback peer with --trust-proxy', () => {
    expect(clientKey('127.0.0.1', '203.0.113.9', true)).toBe('203.0.113.9');
    expect(clientKey('127.0.0.1', '198.51.100.1, 203.0.113.9', true)).toBe('203.0.113.9');
    expect(clientKey('::ffff:127.0.0.1', '203.0.113.9', true)).toBe('203.0.113.9');
    expect(clientKey('::1', '203.0.113.9', true)).toBe('203.0.113.9');
  });

  it('ignores the header from a non-loopback peer either way', () => {
    expect(clientKey('198.51.100.7', '203.0.113.9', true)).toBe('198.51.100.7');
    expect(clientKey('198.51.100.7', '203.0.113.9', false)).toBe('198.51.100.7');
  });

  it('falls back to the peer key for a malformed entry', () => {
    expect(clientKey('127.0.0.1', 'not-an-ip', true)).toBe('127.0.0.1');
    expect(clientKey('127.0.0.1', '203.0.113.9, junk', true)).toBe('127.0.0.1');
  });
});
