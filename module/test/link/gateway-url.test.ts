import { describe, expect, it } from 'vitest';
import {
  displayAddress,
  effectiveFromSettings,
  effectiveGatewayUrl,
  isLoopbackHost,
  isServerModeUrl,
  isStrictGatewayUrl,
  resolveGateway,
} from '../../src/link/gateway-url.js';

const WORLD = 'wss://gw.example.com/link';
const LEGACY = 'ws://localhost:7420';

describe('effectiveGatewayUrl', () => {
  it('uses the client value when it is set', () => {
    expect(effectiveGatewayUrl('ws://gw', WORLD)).toBe('ws://gw');
  });
  it('falls back to a valid world default', () => {
    expect(effectiveGatewayUrl('', WORLD)).toBe(WORLD);
    expect(effectiveGatewayUrl('   ', WORLD)).toBe(WORLD);
  });
  it('falls back to localhost with no usable world default', () => {
    expect(effectiveGatewayUrl('', '')).toBe(LEGACY);
    expect(effectiveGatewayUrl('', 'https://gw/link')).toBe(LEGACY);
    expect(effectiveGatewayUrl('', 'wss://u:p@gw/link')).toBe(LEGACY);
  });
  it('treats the legacy stored default as inherit when the world default is valid', () => {
    expect(effectiveGatewayUrl(LEGACY, WORLD)).toBe(WORLD);
    expect(effectiveGatewayUrl(LEGACY, '')).toBe(LEGACY);
    expect(effectiveGatewayUrl(LEGACY, 'junk')).toBe(LEGACY);
  });
  it('a player can still pick loopback by another spelling', () => {
    expect(effectiveGatewayUrl('ws://127.0.0.1:7420', WORLD)).toBe('ws://127.0.0.1:7420');
  });
  it('never returns a client value with a fragment or credentials', () => {
    for (const bad of [
      'wss://gw/link#ABCD-EFGH-JKMN',
      'wss://u:p@gw/link',
      'not a url',
      'ws://gw/link#x',
      'wss://u@gw',
    ]) {
      expect(effectiveGatewayUrl(bad, WORLD)).toBe(WORLD);
      expect(effectiveGatewayUrl(bad, '')).toBe(LEGACY);
      expect(resolveGateway(bad, WORLD).clientInvalid).toBe(true);
    }
  });
});

describe('resolveGateway', () => {
  it('reports the source and a bad world default', () => {
    expect(resolveGateway('ws://gw', WORLD)).toMatchObject({ source: 'client' });
    expect(resolveGateway('', WORLD)).toMatchObject({ source: 'world', worldInvalid: false });
    expect(resolveGateway('', '')).toMatchObject({ source: 'default', worldInvalid: false });
    expect(resolveGateway('', 'http://x')).toMatchObject({ source: 'default', worldInvalid: true });
  });
});

describe('effectiveFromSettings', () => {
  it('reads both settings and tolerates an unregistered world default', () => {
    expect(effectiveFromSettings(() => '')).toBe(LEGACY);
    expect(
      effectiveFromSettings((k) => {
        if (k === 'defaultGatewayUrl') throw new Error('not registered');
        return 'ws://gw';
      }),
    ).toBe('ws://gw');
    expect(effectiveFromSettings((k) => (k === 'gatewayUrl' ? '' : WORLD))).toBe(WORLD);
  });
});

describe('isStrictGatewayUrl', () => {
  it.each([WORLD, 'wss://gw', 'ws://localhost:7420', 'ws://127.0.0.1:1/link', 'ws://[::1]:1/x'])(
    'accepts %s',
    (u) => expect(isStrictGatewayUrl(u)).toBe(true),
  );
  it.each([
    'ws://gw.example.com/link',
    'https://gw/link',
    'wss://u:p@gw/link',
    'wss://gw/link?x=1',
    'wss://gw/link#ABCD',
    '',
    'nope',
    `wss://gw/${'a'.repeat(2048)}`,
  ])('rejects %s', (u) => expect(isStrictGatewayUrl(u)).toBe(false));
});

describe('isLoopbackHost / isServerModeUrl', () => {
  it('knows loopback hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '127.9.9.9', '[::1]', '::1'])
      expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['gw.example.com', '128.0.0.1', 'localhost.evil.com', '127.0.0.1.evil.com'])
      expect(isLoopbackHost(h)).toBe(false);
  });
  it('server mode is a non-loopback address', () => {
    expect(isServerModeUrl(WORLD)).toBe(true);
    expect(isServerModeUrl('ws://localhost:7420')).toBe(false);
    expect(isServerModeUrl('ws://127.0.0.1:7420')).toBe(false);
    expect(isServerModeUrl('garbage')).toBe(false);
  });
});

describe('displayAddress', () => {
  it('keeps scheme, host, port and path only', () => {
    expect(displayAddress('wss://u:p@gw.example.com:8443/link?token=s#CODE')).toBe(
      'wss://gw.example.com:8443/link',
    );
    expect(displayAddress('ws://localhost:7420')).toBe('ws://localhost:7420');
  });
  it('never echoes an unparseable value', () => {
    expect(displayAddress('<script>alert(1)</script>')).toBe('');
  });
  it('bounds the length', () => {
    expect(displayAddress(`wss://gw/${'a'.repeat(5000)}`).length).toBeLessThanOrEqual(200);
  });
});

describe('clientUsable userinfo shapes', () => {
  it.each(['ws:\\u:p@evil.com/link', 'ws:/u:p@evil.com/link', 'ws:u:p@evil.com/link'])(
    'refuses %s',
    (v) => {
      expect(resolveGateway(v, '').clientInvalid).toBe(true);
    },
  );
});
