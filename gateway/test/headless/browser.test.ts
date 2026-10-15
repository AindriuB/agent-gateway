import { describe, expect, it } from 'vitest';
import { findBrowser } from '../../src/headless/browser.js';

const has = (...paths: string[]) => ({
  platform: 'linux' as const,
  env: {},
  exists: (p: string) => paths.includes(p),
  list: () => ['chromium-1234', 'chromium-1300', 'ffmpeg-1'],
});

describe('findBrowser', () => {
  it('prefers Chrome, then Edge, then Chromium', () => {
    expect(
      findBrowser(
        '/s',
        has('/usr/bin/chromium', '/usr/bin/microsoft-edge', '/usr/bin/google-chrome'),
      ),
    ).toEqual({ kind: 'chrome', path: '/usr/bin/google-chrome' });
    expect(findBrowser('/s', has('/usr/bin/chromium', '/usr/bin/microsoft-edge'))?.kind).toBe(
      'edge',
    );
    expect(findBrowser('/s', has('/usr/bin/chromium'))).toEqual({
      kind: 'chromium',
      path: '/usr/bin/chromium',
    });
  });

  it('falls back to a Chromium downloaded under <state dir>/browsers/', () => {
    expect(findBrowser('/s', has('/s/browsers/chromium-1300/chrome-linux/chrome'))).toEqual({
      kind: 'downloaded',
      path: '/s/browsers/chromium-1300/chrome-linux/chrome',
    });
  });

  it('is undefined when nothing is installed', () => {
    expect(findBrowser('/s', has())).toBeUndefined();
  });
});
