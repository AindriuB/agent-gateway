import { describe, expect, it } from 'vitest';
import { FIXTURES_SKIPPED_LINE, SKIP_FIXTURES_ENV, fixturePolicy } from './run.js';

describe('fixturePolicy', () => {
  it('does not skip by default or for any value but 1', () => {
    expect(fixturePolicy({}, [])).toEqual({ skip: false });
    expect(fixturePolicy({ [SKIP_FIXTURES_ENV]: '0' }, ['dnd5e'])).toEqual({ skip: false });
    expect(fixturePolicy({ [SKIP_FIXTURES_ENV]: 'true' }, ['dnd5e'])).toEqual({ skip: false });
  });
  it('skips only with a suite filter', () => {
    expect(fixturePolicy({ [SKIP_FIXTURES_ENV]: '1' }, ['dnd5e'])).toEqual({ skip: true });
  });
  it('refuses to skip when every suite would run', () => {
    expect(() => fixturePolicy({ [SKIP_FIXTURES_ENV]: '1' }, [])).toThrow(/suite filter/);
    expect(() => fixturePolicy({ [SKIP_FIXTURES_ENV]: '1' }, ['--bail'])).toThrow(/suite filter/);
  });
  it('prints a clear skipped line', () => {
    expect(FIXTURES_SKIPPED_LINE).toContain('fixtures skipped');
    expect(FIXTURES_SKIPPED_LINE).toContain(SKIP_FIXTURES_ENV);
  });
});
