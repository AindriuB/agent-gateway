import { describe, expect, it } from 'vitest';
import {
  FIXTURES_SKIPPED_LINE,
  SKIP_FIXTURES_ENV,
  fixturePolicy,
  livePreflight,
  type PreflightSession,
} from './run.js';

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

describe('livePreflight ordering', () => {
  const cfg = { gmUser: 'gm', playerUser: 'p1' };
  const paths = { runData: '/nonexistent/run-data' };
  const harness = (callResult: unknown = {}) => {
    const log: string[] = [];
    const open = async (user: string): Promise<PreflightSession> => {
      log.push(`open:${user}`);
      return {
        foundryVersion: '14.369',
        gateway: { call: async (name: string) => (log.push(`call:${name}`), callResult as never) },
        close: async () => void log.push(`close:${user}`),
      };
    };
    return { log, open };
  };
  it('closes the GM session before the player session opens when fixtures are skipped', async () => {
    const h = harness();
    expect(await livePreflight(cfg, paths, h.open, true)).toBe('14.369');
    expect(h.log).toEqual(['open:gm', 'close:gm', 'open:p1', 'close:p1']);
  });
  it('makes no fixture calls when skipped', async () => {
    const h = harness();
    await livePreflight(cfg, paths, h.open, true);
    expect(h.log.some((l) => l.startsWith('call:'))).toBe(false);
  });
  it('closes the GM session before the player opens on the fixture path too, and when it fails', async () => {
    const failing = harness({ structured: { results: [] } });
    await expect(livePreflight(cfg, paths, failing.open, false)).rejects.toThrow(
      /fixtures not found/,
    );
    expect(failing.log).toEqual(['open:gm', 'call:document_search', 'close:gm']);
  });
});
