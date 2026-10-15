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
  const cft = ['Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'];
  // Current playwright-core layouts first, then the older folder names.
  const rels: string[][] =
    platform === 'darwin'
      ? [
          ['chrome-mac-arm64', ...cft],
          ['chrome-mac-x64', ...cft],
          ['chrome-mac', ...cft],
          ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
        ]
      : platform === 'win32'
        ? [
            ['chrome-win64', 'chrome.exe'],
            ['chrome-win', 'chrome.exe'],
          ]
        : [
            ['chrome-linux64', 'chrome'],
            ['chrome-linux-arm64', 'chrome'],
            ['chrome-linux', 'chrome'],
          ];
  let dirs: string[];
  try {
    dirs = list(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((x, y) => Number(y.slice(9)) - Number(x.slice(9)));
  } catch {
    return undefined;
  }
  for (const d of dirs) {
    for (const rel of rels) {
      const p = join(root, d, ...rel);
      if (exists(p)) return p;
    }
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

/**
 * The options handed to `launchPersistentContext`. Playwright adds `--no-sandbox` unless
 * `chromiumSandbox: true` is passed, and installs its own SIGINT/SIGTERM/SIGHUP handlers that kill
 * the browser and exit the process. The sandbox is set explicitly; all three signal handlers are
 * turned off because cli.ts handles SIGINT, SIGTERM and SIGHUP with a graceful `app.stop()`, which
 * closes the browser. Only the gateway decides what a signal does.
 */
export function launchOptions(executablePath: string, req: Pick<LaunchRequest, 'noSandbox'>) {
  return {
    executablePath,
    headless: true,
    viewport: { width: 1280, height: 800 },
    chromiumSandbox: !req.noSandbox,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  };
}

/** Sandbox start-up failures (Ubuntu AppArmor limits on user namespaces, missing setuid helper). */
export function explainLaunchError(err: unknown, sandboxOn: boolean): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    sandboxOn &&
    /Chromium sandboxing failed!|No usable sandbox!|crbug\.com\/357670|crbug\.com\/638180/.test(msg)
  )
    return new Error(
      'Chromium could not start with its sandbox (often Ubuntu AppArmor restricting unprivileged user namespaces, or a container); set AGENT_GATEWAY_HEADLESS_NO_SANDBOX=1 to run it unsandboxed',
    );
  return err instanceof Error ? err : new Error(msg);
}

/** The slice of a Playwright context that `preparePage` uses. */
export interface PreparableContext<P> {
  addInitScript(script: string): Promise<unknown>;
  pages(): P[];
  newPage(): Promise<P>;
  close(): Promise<void>;
}

/**
 * Install the init script and pick the page. A failure after the launch closes the context, or it
 * would keep the profile lock until the process exits.
 */
export async function preparePage<P>(
  context: PreparableContext<P>,
  initScript: string,
): Promise<P> {
  try {
    await context.addInitScript(initScript);
    return context.pages()[0] ?? (await context.newPage());
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}

/** The real launcher: Chromium through `playwright-core`, one persistent context per profile dir. */
export function playwrightLauncher(executablePath: string): BrowserLauncher {
  return {
    async launch(req: LaunchRequest): Promise<RunnerBrowser> {
      // A non-literal specifier keeps esbuild (the .mcpb bundle) from inlining playwright-core.
      const specifier = 'playwright-core';
      let chromium: typeof import('playwright-core').chromium;
      try {
        ({ chromium } = (await import(specifier)) as typeof import('playwright-core'));
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND')
          throw new Error(
            'playwright-core is not installed; the headless runner needs the npm or Docker install, not the .mcpb bundle',
          );
        throw err;
      }
      const context = await chromium
        .launchPersistentContext(req.profileDir, launchOptions(executablePath, req))
        .catch((err: unknown) => {
          throw explainLaunchError(err, !req.noSandbox);
        });
      const page = await preparePage(context, req.initScript);
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
      let closed = false;
      const listeners: (() => void)[] = [];
      const gone = (): void => {
        if (closed) return;
        closed = true;
        for (const cb of listeners.splice(0)) cb();
      };
      context.on('close', gone);
      context.browser()?.on('disconnected', gone);
      page.on('close', gone);
      page.on('crash', gone);
      return {
        page: wrapped,
        close: () => context.close(),
        onClosed: (cb) => {
          if (closed) cb();
          else listeners.push(cb);
        },
        isClosed: () => closed || page.isClosed(),
      };
    },
  };
}
