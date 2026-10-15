import { describe, expect, it } from 'vitest';
import { HEADLESS_INVITE_TTL_MS, HeadlessInvites } from '../../src/headless/invites.js';
import { INVITE_CODE_PATTERN } from '../../src/link/invites.js';

const O = 'http://localhost:30000';

function make() {
  const s = { active: true, clock: 0 };
  const inv = new HeadlessInvites({ isAgentActive: () => s.active, now: () => s.clock });
  return { s, inv };
}

describe('HeadlessInvites', () => {
  it('mints a code of the invite shape and keeps one live invite per agent', () => {
    const { inv } = make();
    const a = inv.mint('w', 'u', O)!;
    expect(a).toMatch(INVITE_CODE_PATTERN);
    const b = inv.mint('w', 'u', O)!;
    expect(inv.size).toBe(1);
    expect(inv.redeem(a, { worldId: 'w', userId: 'u', origin: O })).toBe('unknown');
    expect(inv.redeem(b, { worldId: 'w', userId: 'u', origin: O })).toBe('match');
    expect(inv.redeem(b, { worldId: 'w', userId: 'u', origin: O })).toBe('unknown');
  });

  it('expires after two minutes', () => {
    const { s, inv } = make();
    expect(HEADLESS_INVITE_TTL_MS).toBe(120_000);
    const code = inv.mint('w', 'u', O)!;
    s.clock = HEADLESS_INVITE_TTL_MS;
    expect(inv.redeem(code, { worldId: 'w', userId: 'u', origin: O })).toBe('mismatch');
    const fresh = inv.mint('w', 'u', O)!;
    expect(inv.redeem(fresh, { worldId: 'w', userId: 'u', origin: O })).toBe('match');
  });

  it('refuses a wrong target and spends the invite', () => {
    const { inv } = make();
    for (const claim of [
      { worldId: 'x', userId: 'u', origin: O },
      { worldId: 'w', userId: 'x', origin: O },
      { worldId: 'w', userId: 'u', origin: 'http://other' },
    ]) {
      const code = inv.mint('w', 'u', O)!;
      expect(inv.redeem(code, claim)).toBe('mismatch');
      expect(inv.redeem(code, { worldId: 'w', userId: 'u', origin: O })).toBe('unknown');
    }
  });

  it('asks isAgentActive at mint and at redeem', () => {
    const { s, inv } = make();
    const code = inv.mint('w', 'u', O)!;
    s.active = false;
    expect(inv.redeem(code, { worldId: 'w', userId: 'u', origin: O })).toBe('mismatch');
    expect(inv.mint('w', 'u', O)).toBeUndefined();
    expect(inv.size).toBe(0);
  });

  it('dropAgent discards every outstanding invite for that agent only', () => {
    const { inv } = make();
    const mine = inv.mint('w', 'u', O)!;
    const other = inv.mint('w', 'v', O)!;
    inv.dropAgent('w', 'u');
    expect(inv.redeem(mine, { worldId: 'w', userId: 'u', origin: O })).toBe('unknown');
    expect(inv.redeem(other, { worldId: 'w', userId: 'v', origin: O })).toBe('match');
  });
});
