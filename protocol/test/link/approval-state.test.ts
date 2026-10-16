import { describe, expect, it } from 'vitest';
import {
  MAX_APPROVAL_STATE_IDS,
  PROTOCOL_VERSION,
  parseLinkMessage,
} from '../../src/link/index.js';

const ok = (v: unknown): boolean => parseLinkMessage(JSON.stringify(v)).ok;
const t = (over: Record<string, unknown>) => ({ type: 'approvalState', ...over });

describe('approvalState frame', () => {
  it('is protocol 7.2.0', () => expect(PROTOCOL_VERSION).toBe('7.2.0'));
  it('accepts a transition for every state', () => {
    for (const state of ['pending', 'approved', 'denied', 'expired'])
      expect(ok(t({ id: 'abc', state }))).toBe(true);
  });
  it('accepts a list, empty and at the cap', () => {
    expect(ok(t({ ids: [] }))).toBe(true);
    expect(ok(t({ ids: Array.from({ length: MAX_APPROVAL_STATE_IDS }, (_, i) => `i${i}`) }))).toBe(
      true,
    );
  });
  it('refuses an unknown state', () => expect(ok(t({ id: 'a', state: 'unknown' }))).toBe(false));
  it('refuses an id over 64 chars, alone or in a list', () => {
    expect(ok(t({ id: 'a'.repeat(65), state: 'pending' }))).toBe(false);
    expect(ok(t({ ids: ['a'.repeat(65)] }))).toBe(false);
    expect(ok(t({ id: 'a'.repeat(64), state: 'pending' }))).toBe(true);
  });
  it('refuses an over-long list', () => {
    expect(ok(t({ ids: Array.from({ length: MAX_APPROVAL_STATE_IDS + 1 }, (_, i) => `i${i}`) }))).toBe(
      false,
    );
  });
  it('refuses mixed or incomplete forms and extra keys', () => {
    expect(ok(t({}))).toBe(false);
    expect(ok(t({ id: 'a' }))).toBe(false);
    expect(ok(t({ state: 'pending' }))).toBe(false);
    expect(ok(t({ id: 'a', state: 'pending', ids: [] }))).toBe(false);
    expect(ok(t({ ids: [], extra: 1 }))).toBe(false);
  });
});
