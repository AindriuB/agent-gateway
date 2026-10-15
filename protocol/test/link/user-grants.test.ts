import { describe, expect, it } from 'vitest';
import { parseLinkMessage } from '../../src/link/index.js';

const ok = (v: unknown): boolean => parseLinkMessage(JSON.stringify(v)).ok;

const grant = { id: 'g', clientName: 'App', scopes: ['read'], createdAt: 1 };

describe('per-user grants messages', () => {
  it('parse in their plain shapes', () => {
    expect(ok({ type: 'listUserGrants', requestId: 'r', userId: 'u' })).toBe(true);
    expect(ok({ type: 'revokeUserGrant', requestId: 'r', userId: 'u', grantId: 'g' })).toBe(true);
    expect(ok({ type: 'userGrants', requestId: 'r', userId: 'u', grants: [grant] })).toBe(true);
  });

  it('reject a world id, extra fields and missing fields', () => {
    expect(ok({ type: 'listUserGrants', requestId: 'r', userId: 'u', worldId: 'w2' })).toBe(false);
    expect(
      ok({ type: 'revokeUserGrant', requestId: 'r', userId: 'u', grantId: 'g', worldId: 'w' }),
    ).toBe(false);
    expect(ok({ type: 'listUserGrants', requestId: 'r' })).toBe(false);
    expect(ok({ type: 'revokeUserGrant', requestId: 'r', userId: 'u' })).toBe(false);
    expect(ok({ type: 'userGrants', requestId: 'r', grants: [] })).toBe(false);
    expect(ok({ type: 'userGrants', requestId: 'r', userId: 'u', grants: [], worldId: 'w' })).toBe(
      false,
    );
  });

  it('reject a token or secret riding in a grant', () => {
    expect(
      ok({
        type: 'userGrants',
        requestId: 'r',
        userId: 'u',
        grants: [{ ...grant, tokenHash: 'h' }],
      }),
    ).toBe(false);
  });
});

describe('last-used time', () => {
  it('never rides in an admin grants reply', () => {
    expect(
      ok({
        type: 'userGrants',
        requestId: 'r',
        userId: 'u',
        grants: [{ ...grant, lastUsedAt: null }],
      }),
    ).toBe(false);
  });
});
