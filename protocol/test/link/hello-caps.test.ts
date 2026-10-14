import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, parseLinkMessage } from '../../src/link/index.js';

const make = (over: { worldId?: string; userId?: string; name?: string; code?: string }) => ({
  type: 'hello',
  protocolVersion: PROTOCOL_VERSION,
  moduleVersion: '0.1.0',
  foundryVersion: '14.0',
  world: { id: over.worldId ?? 'w', title: 'W', system: 'dnd5e', systemVersion: '5' },
  user: { id: over.userId ?? 'u', name: over.name ?? 'GM', role: 4, isGM: true },
  auth: { kind: 'pairingCode', code: over.code ?? 'ABCD-1234' },
});
const ok = (v: unknown): boolean => parseLinkMessage(JSON.stringify(v)).ok;

describe('hello length caps', () => {
  it('accepts values at the cap', () => {
    expect(
      ok(
        make({
          worldId: 'a'.repeat(64),
          userId: 'b'.repeat(64),
          name: 'n'.repeat(100),
          code: 'c'.repeat(64),
        }),
      ),
    ).toBe(true);
  });
  it('refuses a world id of 65', () => expect(ok(make({ worldId: 'a'.repeat(65) }))).toBe(false));
  it('refuses a user id of 65', () => expect(ok(make({ userId: 'a'.repeat(65) }))).toBe(false));
  it('refuses a user name of 101', () => expect(ok(make({ name: 'n'.repeat(101) }))).toBe(false));
  it('refuses an auth code of 65', () => expect(ok(make({ code: 'c'.repeat(65) }))).toBe(false));
});
