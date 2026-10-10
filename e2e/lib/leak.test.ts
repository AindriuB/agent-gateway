import { describe, expect, it } from 'vitest';
import { HIDDEN_STRINGS, leakMatchers } from '../fixtures/manifest.js';
import { LeakChecker, LeakError } from './leak.js';

describe('LeakChecker', () => {
  it('passes clean results and counts them', () => {
    const c = new LeakChecker(leakMatchers(23));
    c.check('chat_read', {}, { content: [{ type: 'text', text: 'hello ag-test-public' }] });
    c.check('world_info', {}, { structuredContent: { ts: 1700000000023 } });
    expect(c.summary()).toEqual({ results: 2, strings: HIDDEN_STRINGS.length + 1, hits: 0 });
    expect(c.line()).toBe(`leak check: 2 results x ${HIDDEN_STRINGS.length + 1} strings, 0 hits`);
  });

  it.each(HIDDEN_STRINGS)('catches %s', (s) => {
    const c = new LeakChecker(leakMatchers());
    expect(() =>
      c.check('document_get', { uuid: 'u' }, { text: `x ${s.toUpperCase()} y` }),
    ).toThrow(LeakError);
    expect(c.summary().hits).toBe(1);
  });

  it('names the tool, arguments and string', () => {
    const c = new LeakChecker(leakMatchers());
    expect(() => c.check('chat_read', { limit: 5 }, { text: 'rolled 7d6' })).toThrow(
      /tool chat_read with arguments {"limit":5} returned hidden string "7d6"/,
    );
  });

  it('matches the blind roll total only where it is labelled as a total', () => {
    const c = new LeakChecker(leakMatchers(23));
    c.check('chat_read', {}, { structuredContent: { id: 'a23b', timestamp: 1700000230000 } });
    expect(() => c.check('chat_read', {}, { structuredContent: { rollTotal: 23 } })).toThrow(
      LeakError,
    );
    expect(() => c.check('chat_read', {}, { text: '7 dice = 23' })).toThrow(LeakError);
  });

  it('does not flag the strings a player may see', () => {
    const c = new LeakChecker(leakMatchers());
    c.check('x', {}, { text: 'ag-test-public, ag-test public message, ag-test OWN SECRET' });
  });
});
