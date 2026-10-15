import { describe, expect, it } from 'vitest';
import { headlessFingerprint, makeRelayConfig } from '../../../src/relay/config.js';

const agent = { foundryUrl: 'http://f:1', worldId: 'w', userId: 'u', password: 'pw' };
const a1 = { name: 'a1', password: 'p1' };
const b2 = { name: 'b2', password: 'p2' };

describe('headlessFingerprint with stored agents', () => {
  it('is byte-identical to the single-agent form when stored is empty', () => {
    expect(headlessFingerprint(agent, false, [])).toBe(headlessFingerprint(agent, false));
    expect(headlessFingerprint(agent, true, [])).toBe(headlessFingerprint(agent, true));
    expect(headlessFingerprint(undefined, false, [])).toBe('');
  });

  it('is a 64-hex digest for stored passwords alone', () => {
    expect(headlessFingerprint(undefined, false, [{ name: 'a1', password: 'p' }])).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('changes with a stored password, a stored name, and the set of agents', () => {
    const base = headlessFingerprint(agent, false, [a1]);
    expect(headlessFingerprint(agent, false, [{ ...a1, password: 'other' }])).not.toBe(base);
    expect(headlessFingerprint(agent, false, [{ ...a1, name: 'a2' }])).not.toBe(base);
    expect(headlessFingerprint(agent, false, [a1, b2])).not.toBe(base);
    expect(headlessFingerprint(agent, false, [a1])).not.toBe(headlessFingerprint(agent, false));
  });

  it('ignores the order of the pairs', () => {
    expect(headlessFingerprint(agent, false, [a1, b2])).toBe(
      headlessFingerprint(agent, false, [b2, a1]),
    );
  });

  it('keeps passwords out of the wire form of the relay config', () => {
    const cfg = makeRelayConfig([], 1, 'info', 0, {
      headless: headlessFingerprint(agent, false, [a1, b2]),
    });
    const wire = JSON.stringify(cfg);
    for (const secret of ['pw', 'p1', 'p2']) expect(wire).not.toContain(`"${secret}"`);
  });
});
