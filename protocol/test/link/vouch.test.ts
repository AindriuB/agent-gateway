import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, checkCompat, parseLinkMessage } from '../../src/link/index.js';

const ok = (f: unknown) => parseLinkMessage(JSON.stringify(f)).ok;

describe('vouch messages', () => {
  it('is protocol 7 and refuses 6 naming the side to upgrade', () => {
    expect(PROTOCOL_VERSION).toBe('7.0.0');
    const r = checkCompat('6.0.0', PROTOCOL_VERSION);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/upgrade the local side/i);
  });

  it('parses pairingChallenge and attest', () => {
    expect(ok({ type: 'pairingChallenge', nonce: 'n'.repeat(22), expiresAt: 5 })).toBe(true);
    expect(ok({ type: 'attest', nonce: 'n'.repeat(22), authorId: 'u1', authorIsGM: false })).toBe(
      true,
    );
  });

  it.each([
    { type: 'pairingChallenge', nonce: '', expiresAt: 5 },
    { type: 'pairingChallenge', nonce: 'n', expiresAt: -1 },
    { type: 'pairingChallenge', nonce: 'n', expiresAt: 5, extra: 1 },
    { type: 'attest', nonce: 'n', authorId: 'u1' },
    { type: 'attest', nonce: 'n', authorId: 'x'.repeat(65), authorIsGM: false },
    { type: 'attest', nonce: 'n'.repeat(201), authorId: 'u', authorIsGM: false },
    { type: 'attest', nonce: 'n', authorId: 'u', authorIsGM: 'no' },
  ])('refuses malformed %j', (f) => {
    expect(ok(f)).toBe(false);
  });

  it('welcome carries an optional boolean admin', () => {
    const w = {
      type: 'welcome',
      gatewayVersion: '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: 'c',
      agentId: 'a',
    };
    expect(ok(w)).toBe(true);
    expect(ok({ ...w, admin: true })).toBe(true);
    expect(ok({ ...w, admin: 'yes' })).toBe(false);
  });
});
