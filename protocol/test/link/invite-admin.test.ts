import { describe, expect, it } from 'vitest';
import { parseLinkMessage } from '../../src/link/index.js';

const ok = (v: unknown): boolean => parseLinkMessage(JSON.stringify(v)).ok;

describe('delegated invite messages', () => {
  it('parse in their plain shapes', () => {
    expect(ok({ type: 'createInvite', requestId: 'r', userId: 'u' })).toBe(true);
    expect(ok({ type: 'createInvite', requestId: 'r', userId: 'u', ttlMs: 60_000 })).toBe(true);
    expect(ok({ type: 'listInvites', requestId: 'r' })).toBe(true);
    expect(ok({ type: 'cancelInvite', requestId: 'r', inviteId: 'i' })).toBe(true);
    expect(
      ok({ type: 'inviteCreated', requestId: 'r', inviteId: 'i', code: 'C', expiresAt: 5 }),
    ).toBe(true);
    expect(
      ok({
        type: 'invites',
        requestId: 'r',
        invites: [{ id: 'i', userId: 'u', createdAt: 1, expiresAt: 2, status: 'unused' }],
      }),
    ).toBe(true);
    expect(ok({ type: 'error', id: '', requestId: 'r', code: 'FORBIDDEN', message: 'no' })).toBe(
      true,
    );
  });

  it('refuse a world id on any request', () => {
    expect(ok({ type: 'createInvite', requestId: 'r', userId: 'u', worldId: 'w' })).toBe(false);
    expect(ok({ type: 'listInvites', requestId: 'r', worldId: 'w' })).toBe(false);
    expect(ok({ type: 'cancelInvite', requestId: 'r', inviteId: 'i', worldId: 'w' })).toBe(false);
  });

  it('refuse missing or oversize fields and a non-integer ttl', () => {
    expect(ok({ type: 'createInvite', requestId: 'r' })).toBe(false);
    expect(ok({ type: 'createInvite', requestId: 'r', userId: 'u'.repeat(65) })).toBe(false);
    expect(ok({ type: 'createInvite', requestId: 'r', userId: 'u', ttlMs: 1.5 })).toBe(false);
    expect(ok({ type: 'cancelInvite', requestId: '', inviteId: 'i' })).toBe(false);
  });
});
