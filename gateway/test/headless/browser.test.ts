import { describe, expect, it } from 'vitest';
import {
  explainLaunchError,
  findBrowser,
  launchOptions,
  preparePage,
} from '../../src/headless/browser.js';

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

  it('leaves SIGINT, SIGTERM and SIGHUP to cli.ts', () => {
    const o = launchOptions('/x/chrome', { noSandbox: false });
    expect([o.handleSIGINT, o.handleSIGTERM, o.handleSIGHUP]).toEqual([false, false, false]);
  });
});

describe('explainLaunchError', () => {
  it('names the cause and the setting for a sandbox failure with the sandbox on', () => {
    const e = explainLaunchError(
      new Error('Chromium sandboxing failed!\nNo usable sandbox!'),
      true,
    );
    expect(e.message).toContain('AGENT_GATEWAY_HEADLESS_NO_SANDBOX');
  });

  it('keeps its own message when the sandbox was already off', () => {
    const m = 'spawn /bin/false ENOENT\n<launching> /bin/false --no-sandbox --headless';
    expect(explainLaunchError(new Error(m), false).message).toBe(m);
    expect(explainLaunchError(new Error('No usable sandbox!'), false).message).toBe(
      'No usable sandbox!',
    );
  });

  it('keeps a non-sandbox failure with the sandbox on', () => {
    expect(explainLaunchError(new Error('Target closed'), true).message).toBe('Target closed');
  });
});

describe('preparePage', () => {
  const ctx = (over: Partial<Parameters<typeof preparePage>[0]>) => {
    const state = { closed: 0 };
    return {
      state,
      ctx: {
        addInitScript: async () => undefined,
        pages: () => [] as string[],
        newPage: async () => 'page',
        close: async () => void state.closed++,
        ...over,
      },
    };
  };

  it('returns the first page without closing', async () => {
    const c = ctx({ pages: () => ['p0'] });
    expect(await preparePage(c.ctx, 's')).toBe('p0');
    expect(c.state.closed).toBe(0);
  });

  it.each([
    ['addInitScript', { addInitScript: async () => Promise.reject(new Error('boom')) }],
    ['newPage', { newPage: async () => Promise.reject(new Error('boom')) }],
  ])('closes the context when %s throws', async (_n, over) => {
    const c = ctx(over);
    await expect(preparePage(c.ctx, 's')).rejects.toThrow('boom');
    expect(c.state.closed).toBe(1);
  });
});
