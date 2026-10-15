import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserLauncher, LaunchRequest, RunnerBrowser, RunnerPage } from './runner.js';

export type BrowserKind = 'chrome' | 'edge' | 'chromium' | 'downloaded';
export interface FoundBrowser {
  kind: BrowserKind;
  path: string;
}

type Platform = NodeJS.Platform;

const pf = (env: NodeJS.ProcessEnv, key: string, fallback: string): string => env[key] ?? fallback;

function systemCandidates(
  platform: Platform,
  env: NodeJS.ProcessEnv,
): Record<'chrome' | 'edge' | 'chromium', string[]> {
  if (platform === 'darwin')
    return {
      chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
      edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
      chromium: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    };
  if (platform === 'win32') {
    const roots = [
      pf(env, 'PROGRAMFILES', 'C:\\Program Files'),
      pf(env, 'PROGRAMFILES(X86)', 'C:\\Program Files (x86)'),
      pf(env, 'LOCALAPPDATA', ''),
    ].filter((r) => r !== '');
    return {
      chrome: roots.map((r) => join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      edge: roots.map((r) => join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      chromium: roots.map((r) => join(r, 'Chromium', 'Application', 'chrome.exe')),
    };
  }
  return {
    chrome: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/opt/google/chrome/chrome',
    ],
    edge: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/opt/microsoft/msedge/msedge',
    ],
    chromium: ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  };
}

/** A Chromium that `playwright-core install` put under `<state dir>/browsers/` (PLAYWRIGHT_BROWSERS_PATH). */
function downloaded(
  stateDir: string,
  platform: Platform,
  exists: (p: string) => boolean,
  list: (p: string) => string[],
): string | undefined {
  const root = join(stateDir, 'browsers');
  const rel =
    platform === 'darwin'
      ? ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']
      : platform === 'win32'
        ? ['chrome-win', 'chrome.exe']
        : ['chrome-linux', 'chrome'];
  let dirs: string[];
  try {
    dirs = list(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort()
      .reverse();
  } catch {
    return undefined;
  }
  for (const d of dirs) {
    const p = join(root, d, ...rel);
    if (exists(p)) return p;
  }
  return undefined;
}

export interface DiscoveryDeps {
  platform?: Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  list?: (dir: string) => string[];
}

/** System Chrome, then Edge, then Chromium, then a Chromium downloaded under `<state dir>/browsers/`. */
export function findBrowser(stateDir: string, deps: DiscoveryDeps = {}): FoundBrowser | undefined {
  const platform = deps.platform ?? process.platform;
  const exists = deps.exists ?? existsSync;
  const list = deps.list ?? ((d: string) => readdirSync(d));
  const sys = systemCandidates(platform, deps.env ?? process.env);
  for (const kind of ['chrome', 'edge', 'chromium'] as const) {
    const path = sys[kind].find((p) => exists(p));
    if (path) return { kind, path };
  }
  const path = downloaded(stateDir, platform, exists, list);
  return path ? { kind: 'downloaded', path } : undefined;
}

/** The real launcher: Chromium through `playwright-core`, one persistent context per profile dir. */
export function playwrightLauncher(executablePath: string): BrowserLauncher {
  return {
    async launch(req: LaunchRequest): Promise<RunnerBrowser> {
      const { chromium } = await import('playwright-core');
      const context = await chromium.launchPersistentContext(req.profileDir, {
        executablePath,
        headless: true,
        viewport: { width: 1280, height: 800 },
        args: req.args,
      });
      await context.addInitScript(req.initScript);
      const page = context.pages()[0] ?? (await context.newPage());
      const wrapped: RunnerPage = {
        goto: async (url, opts) => void (await page.goto(url, opts)),
        url: () => page.url(),
        waitForSelector: async (s, opts) => void (await page.waitForSelector(s, opts)),
        selectOption: async (s, o) => void (await page.selectOption(s, o)),
        fill: (s, v) => page.fill(s, v),
        click: (s) => page.click(s),
        evaluate: (script) => page.evaluate(script),
        waitForGameReady: async (ms) =>
          void (await page.waitForFunction('globalThis.game?.ready === true', undefined, {
            timeout: ms,
          })),
      };
      return { page: wrapped, close: () => context.close() };
    },
  };
}
