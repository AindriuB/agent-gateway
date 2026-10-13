import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_PATTERN,
  PAIRING_CODE_TTL_MS,
  PairingCodes,
  type CodeReason,
} from '../../src/link/index.js';

/** A clock and timer queue the test drives by hand; counts how many timers are armed. */
function manual() {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const issued: { code: string; reason: CodeReason }[] = [];
  const codes = new PairingCodes({
    now: () => t,
    setTimer: (fn, ms) => {
      const id = next++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h) => void timers.delete(h as number),
    onIssued: (i) => issued.push({ code: i.code, reason: i.reason }),
  });
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, v]) => v.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = due[1].at;
      due[1].fn();
    }
    t = end;
  };
  return { codes, timers, issued, advance, setNow: (v: number) => (t = v) };
}

describe('PairingCodes: one live code, one timer', () => {
  it('issue returns the live code and announces only new ones', () => {
    const m = manual();
    const first = m.codes.issue('startup');
    expect(first.code).toMatch(PAIRING_CODE_PATTERN);
    expect(first.expiresAt).toBe(PAIRING_CODE_TTL_MS);
    expect(m.codes.issue('mcp')).toEqual(first);
    expect(m.codes.generate()).toBe(first.code);
    expect(m.issued).toEqual([{ code: first.code, reason: 'startup' }]);
    expect(m.timers.size).toBe(1);
  });

  it('re-issues on expiry with reason expired; the old code then fails, and there is never more than one code or timer', () => {
    const m = manual();
    const old = m.codes.issue('startup').code;
    m.advance(PAIRING_CODE_TTL_MS - 1);
    expect(m.codes.current()?.code).toBe(old);
    m.advance(1);
    expect(m.issued.map((i) => i.reason)).toEqual(['startup', 'expired']);
    const fresh = m.codes.current()!.code;
    expect(fresh).not.toBe(old);
    expect(m.codes.size).toBe(1);
    expect(m.timers.size).toBe(1);
    expect(m.codes.consume(old)).toBe(false);
    expect(m.codes.consume(fresh)).toBe(true);
  });

  it('a wrong guess spends nothing; a right one is single use and leaves no timer', () => {
    const m = manual();
    const { code } = m.codes.issue('startup');
    expect(m.codes.consume('AAAA-AAAA')).toBe(false);
    expect(m.codes.current()?.code).toBe(code);
    expect(m.codes.consume(` ${code.toLowerCase()} `)).toBe(true);
    expect(m.codes.consume(code)).toBe(false);
    expect(m.codes.current()).toBeUndefined();
    expect(m.timers.size).toBe(0);
    expect(m.codes.armed).toBe(false);
  });

  it('no refresh after pairing: three TTLs later no code was issued and no timer is armed', () => {
    const m = manual();
    m.codes.consume(m.codes.issue('startup').code);
    m.advance(3 * PAIRING_CODE_TTL_MS);
    expect(m.issued).toHaveLength(1);
    expect(m.timers.size).toBe(0);
    // A new code is issued only on demand, and then re-arms exactly one timer.
    m.codes.issue('mcp');
    expect(m.issued.map((i) => i.reason)).toEqual(['startup', 'mcp']);
    expect(m.timers.size).toBe(1);
  });

  it('many demands in a row create one code and one timer', () => {
    const m = manual();
    for (let i = 0; i < 1000; i++) m.codes.issue('refused-token');
    expect(m.issued).toHaveLength(1);
    expect(m.timers.size).toBe(1);
  });

  it('long idleness issues exactly one code per TTL', () => {
    const m = manual();
    m.codes.issue('startup');
    m.advance(50 * PAIRING_CODE_TTL_MS);
    expect(m.issued).toHaveLength(51);
    expect(m.timers.size).toBe(1);
    expect(m.codes.size).toBe(1);
  });

  it('an expired code that is asked for again is replaced even if the timer has not fired', () => {
    const m = manual();
    const old = m.codes.issue('startup');
    m.setNow(old.expiresAt);
    const fresh = m.codes.issue('mcp');
    expect(fresh.code).not.toBe(old.code);
    expect(m.timers.size).toBe(1);
  });

  it('stop clears the timer and nothing is armed afterwards', () => {
    const m = manual();
    m.codes.issue('startup');
    m.codes.stop();
    expect(m.timers.size).toBe(0);
    m.codes.issue('mcp');
    expect(m.timers.size).toBe(0);
  });

  it('the default timer arms on issue and clears on stop', () => {
    const codes = new PairingCodes();
    codes.issue('startup');
    expect(codes.armed).toBe(true);
    codes.stop();
    expect(codes.armed).toBe(false);
  });
});
