import { describe, expect, it } from 'vitest';
import {
  bucketFor,
  DEFAULT_LIMITS,
  loadLimits,
  MAX_LIMIT,
  RateLimitConfigError,
  resolveLimit,
  STRICT_LIMIT,
  validateLimits,
} from '../../src/ratelimit/config.js';

const stored = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_LIMITS, ...over });
const limit = (raw: unknown, cls: 'playerAgents' | 'gmAgents', id: string, b: 'read' | 'write') =>
  resolveLimit(loadLimits(raw), cls, id, b);

describe('bucket mapping', () => {
  it('read is read; write, destructive and code are write; unknown is write', () => {
    expect(bucketFor('read')).toBe('read');
    expect(bucketFor('write')).toBe('write');
    expect(bucketFor('destructive')).toBe('write');
    expect(bucketFor('code')).toBe('write');
    expect(bucketFor('mystery')).toBe('write');
    expect(bucketFor(undefined)).toBe('write');
  });
});

describe('defaults and override precedence', () => {
  it('defaults are 60 read and 10 write for both classes', () => {
    for (const cls of ['playerAgents', 'gmAgents'] as const) {
      expect(limit(JSON.stringify(DEFAULT_LIMITS), cls, 'a', 'read')).toBe(60);
      expect(limit(JSON.stringify(DEFAULT_LIMITS), cls, 'a', 'write')).toBe(10);
    }
  });

  it('a class limit applies to every agent of the class', () => {
    const raw = stored({ gmAgents: { read: 200, write: 20 } });
    expect(limit(raw, 'gmAgents', 'x', 'read')).toBe(200);
    expect(limit(raw, 'playerAgents', 'x', 'read')).toBe(60);
  });

  it('a per-agent override beats the class limit, for that agent and bucket only', () => {
    const raw = stored({ agents: { a1: { write: 3 } } });
    expect(limit(raw, 'playerAgents', 'a1', 'write')).toBe(3);
    expect(limit(raw, 'playerAgents', 'a1', 'read')).toBe(60);
    expect(limit(raw, 'playerAgents', 'a2', 'write')).toBe(10);
  });

  it('an override may raise a limit above the class limit', () => {
    expect(limit(stored({ agents: { a1: { read: 500 } } }), 'gmAgents', 'a1', 'read')).toBe(500);
  });

  it('agent ids that are object prototype names are ordinary keys', () => {
    const raw =
      '{"playerAgents":{"read":60,"write":10},"gmAgents":{"read":60,"write":10},"agents":{"__proto__":{"read":2}}}';
    expect(limit(raw, 'playerAgents', '__proto__', 'read')).toBe(2);
    expect(limit(raw, 'playerAgents', 'constructor', 'read')).toBe(60);
  });
});

describe('fail strict', () => {
  const S = STRICT_LIMIT;
  it.each([
    ['unset', undefined],
    ['null', null],
    ['empty string', ''],
    ['unparseable', '{nope'],
    ['an array', '[]'],
    ['a number', '5'],
  ])('%s gives the strict limit everywhere, never unlimited', (_n, raw) => {
    for (const cls of ['playerAgents', 'gmAgents'] as const) {
      for (const b of ['read', 'write'] as const) expect(limit(raw, cls, 'a', b)).toBe(S);
    }
  });

  it('an invalid cell is strict while a valid sibling is kept', () => {
    const raw = stored({ playerAgents: { read: 'lots', write: 5 } });
    expect(limit(raw, 'playerAgents', 'a', 'read')).toBe(S);
    expect(limit(raw, 'playerAgents', 'a', 'write')).toBe(5);
    expect(limit(raw, 'gmAgents', 'a', 'read')).toBe(60);
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_LIMIT + 1, '60', null, true])(
    'a stored limit of %s is strict',
    (bad) => {
      expect(limit(stored({ gmAgents: { read: bad, write: 10 } }), 'gmAgents', 'a', 'read')).toBe(
        S,
      );
    },
  );

  it('a missing class or bucket is strict, not the default', () => {
    expect(limit({ playerAgents: { read: 60 } }, 'playerAgents', 'a', 'write')).toBe(S);
    expect(limit({ playerAgents: { read: 60, write: 10 } }, 'gmAgents', 'a', 'read')).toBe(S);
  });

  it('an invalid override cell is strict for that agent, not the looser class limit', () => {
    const raw = stored({ agents: { a1: { read: 'x' }, a2: 7 } });
    expect(limit(raw, 'playerAgents', 'a1', 'read')).toBe(S);
    expect(limit(raw, 'playerAgents', 'a1', 'write')).toBe(10);
    expect(limit(raw, 'playerAgents', 'a2', 'read')).toBe(S);
    expect(limit(raw, 'playerAgents', 'a2', 'write')).toBe(S);
    expect(limit(raw, 'playerAgents', 'other', 'read')).toBe(60);
  });

  it('an unreadable overrides block makes every agent strict', () => {
    for (const agents of ['oops', [], 4]) {
      expect(limit(stored({ agents }), 'playerAgents', 'a', 'read')).toBe(S);
    }
  });

  it('a settings read that throws is strict (see store tests)', () => {
    expect(limit(undefined, 'gmAgents', 'a', 'write')).toBe(S);
  });
});

describe('validateLimits (save path)', () => {
  it('accepts a good configuration and returns it', () => {
    expect(validateLimits(stored({ agents: { a: { read: 5 } } }))).toEqual(
      stored({ agents: { a: { read: 5 } } }),
    );
  });

  it.each([
    ['not an object', 'x'],
    ['missing class', { playerAgents: { read: 1, write: 1 }, agents: {} }],
    ['missing bucket', stored({ gmAgents: { read: 1 } })],
    ['zero', stored({ gmAgents: { read: 0, write: 1 } })],
    ['fraction', stored({ gmAgents: { read: 1.5, write: 1 } })],
    ['too high', stored({ gmAgents: { read: MAX_LIMIT + 1, write: 1 } })],
    ['string number', stored({ gmAgents: { read: '5', write: 1 } })],
    ['unknown bucket', stored({ gmAgents: { read: 1, write: 1, code: 1 } })],
    ['unknown class', { ...stored(), robots: { read: 1, write: 1 } }],
    ['bad override', stored({ agents: { a: { read: -1 } } })],
    ['override not an object', stored({ agents: { a: 3 } })],
    ['agents not an object', stored({ agents: [] })],
  ])('rejects %s', (_n, input) => {
    expect(() => validateLimits(input)).toThrow(RateLimitConfigError);
  });
});
