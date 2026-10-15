import { describe, expect, it } from 'vitest';
import { parseLinkMessage } from '../../src/link/index.js';

const ok = (v: unknown): boolean => parseLinkMessage(JSON.stringify(v)).ok;

const row = {
  id: 'p',
  userId: 'u',
  userName: 'Una',
  origin: 'https://x.test',
  createdAt: 1,
  admin: false,
  connected: true,
  self: false,
};

describe('pairing management messages', () => {
  it('parse in their plain shapes', () => {
    expect(ok({ type: 'listPairings', requestId: 'r' })).toBe(true);
    expect(ok({ type: 'revokePairing', requestId: 'r', pairingId: 'p' })).toBe(true);
    expect(ok({ type: 'pairings', requestId: 'r', pairings: [row] })).toBe(true);
    expect(ok({ type: 'pairings', requestId: 'r', pairings: [{ ...row, origin: null }] })).toBe(
      true,
    );
  });

  it('reject a world id, extra fields and a token', () => {
    expect(ok({ type: 'listPairings', requestId: 'r', worldId: 'w2' })).toBe(false);
    expect(ok({ type: 'revokePairing', requestId: 'r', pairingId: 'p', worldId: 'w2' })).toBe(
      false,
    );
    expect(ok({ type: 'revokePairing', requestId: 'r' })).toBe(false);
    expect(ok({ type: 'pairings', requestId: 'r', pairings: [{ ...row, tokenHash: 'h' }] })).toBe(
      false,
    );
    expect(ok({ type: 'pairings', requestId: 'r', pairings: [], worldId: 'w' })).toBe(false);
  });
});
