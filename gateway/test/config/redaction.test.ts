import { describe, expect, it } from 'vitest';
import {
  ConfigError,
  loadConfig,
  normalizeLinkUrl,
  normalizePublicUrl,
} from '../../src/config/index.js';

function message(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError);
    return (err as ConfigError).message;
  }
  throw new Error('expected a ConfigError');
}

function expectRedacted(msg: string): void {
  expect(msg).not.toContain('agent:');
  expect(msg).not.toContain('hunter2');
}

describe('validation errors never echo the value', () => {
  it.each(['https://agent:hunter2@gw.example.com', 'http://agent:hunter2@gw.example.com/path'])(
    '--public-url %s',
    (v) => {
      const msg = message(() => normalizePublicUrl(v));
      expectRedacted(msg);
      expect(msg).not.toContain('agent');
      expect(msg).toContain('--public-url');
    },
  );

  it.each(['--privacy-url', '--source-url'] as const)('%s', (flag) => {
    for (const v of [
      'http://agent:hunter2@example.org/privacy',
      'https://agent:hunter2@example.org/privacy',
    ]) {
      const msg = message(() => normalizeLinkUrl(flag, v));
      expect(msg).not.toContain('agent');
      expect(msg).not.toContain('hunter2');
      expect(msg).toContain(flag);
    }
  });

  it('schema errors carry no secret from a wrongly typed or enum field', () => {
    for (const flags of [
      { linkPort: 'hunter2' },
      { logLevel: 'hunter2' },
      { httpPort: 'hunter2' },
    ]) {
      let msg = '';
      try {
        loadConfig({ env: {}, flags: flags as never });
      } catch (err) {
        msg = (err as Error).message;
      }
      expect(msg).not.toContain('hunter2');
    }
  });
});
