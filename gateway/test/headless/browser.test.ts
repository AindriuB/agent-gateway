import { describe, expect, it } from 'vitest';
import { explainLaunchError, findBrowser, launchOptions } from '../../src/headless/browser.js';

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

  it.each([
    ['linux', '/s/browsers/chromium-1248/chrome-linux64/chrome'],
    ['linux', '/s/browsers/chromium-1248/chrome-linux-arm64/chrome'],
    [
      'darwin',
      '/s/browsers/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ],
    [
      'darwin',
      '/s/browsers/chromium-1248/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ],
    ['win32', '/s/browsers/chromium-1248/chrome-win64/chrome.exe'],
  ] as const)('finds the current %s layout %s', (platform, path) => {
    const deps = {
      ...has(path),
      platform,
      list: () => ['chromium-1248', 'chromium_headless_shell-1248'],
    };
    expect(findBrowser('/s', deps)).toEqual({ kind: 'downloaded', path });
  });

  it('picks the highest chromium build numerically', () => {
    const a = '/s/browsers/chromium-999/chrome-linux64/chrome';
    const b = '/s/browsers/chromium-1248/chrome-linux64/chrome';
    expect(
      findBrowser('/s', { ...has(a, b), list: () => ['chromium-1248', 'chromium-999'] })?.path,
    ).toBe(b);
  });

  it('is undefined when nothing is installed', () => {
    expect(findBrowser('/s', has())).toBeUndefined();
  });
});

describe('launchOptions', () => {
  it.each([
    [false, true],
    [true, false],
  ])('noSandbox %s gives chromiumSandbox %s', (noSandbox, sandbox) => {
    expect(launchOptions('/x/chrome', { noSandbox }).chromiumSandbox).toBe(sandbox);
  });

  it('keeps Playwright from taking over the process signals', () => {
    const o = launchOptions('/x/chrome', { noSandbox: false });
    expect([o.handleSIGINT, o.handleSIGTERM, o.handleSIGHUP]).toEqual([false, false, false]);
  });
});

describe('explainLaunchError', () => {
  it('names the cause and the setting for a sandbox failure', () => {
    const e = explainLaunchError(
      new Error('Failed to move to new namespace: Operation not permitted'),
    );
    expect(e.message).toContain('AGENT_GATEWAY_HEADLESS_NO_SANDBOX');
    expect(e.message).not.toContain('namespace: Operation');
  });
});
