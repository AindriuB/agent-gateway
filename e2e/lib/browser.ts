import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { profileDir, type E2eConfig, type E2ePaths } from './config.js';

/** The selectors the harness relies on. */
export const SELECTORS = {
  joinUser: 'select[name="userId"]',
  joinPassword: 'input[name="password"]',
  joinButton: 'button[name="join"]',
  pairingApp: '#agent-gateway-pairing',
  pairingCode: '#agent-gateway-pairing input[name="code"]',
  banner: '#ag-e2e-banner',
} as const;

export const PAIRING_MENU_KEY = 'agent-gateway.pairing';
export const SETTINGS_NS = 'agent-gateway';

export interface LaunchOptions {
  channel?: string;
  executablePath?: string;
  headless: boolean;
  ignoreHTTPSErrors: boolean;
  viewport: { width: number; height: number };
}

/** `CHROME_PATH` selects a binary; otherwise the system Chrome channel (`AGENT_GATEWAY_E2E_CHANNEL` overrides). */
export function launchOptions(
  headed: boolean,
  env: Record<string, string | undefined> = process.env,
): LaunchOptions {
  const o: LaunchOptions = {
    headless: !headed,
    ignoreHTTPSErrors: env.AGENT_GATEWAY_E2E_INSECURE_TLS === '1',
    viewport: { width: 1400, height: 900 },
  };
  if (env.CHROME_PATH) o.executablePath = env.CHROME_PATH;
  else o.channel = env.AGENT_GATEWAY_E2E_CHANNEL || 'chrome';
  return o;
}

/** The minimal Page surface joinWorld uses; lets tests drive it with a fake. */
export interface JoinPage {
  goto(url: string): Promise<unknown>;
  selectOption(selector: string, option: { label: string }): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
  waitForFunction(fn: string, arg?: unknown, opts?: { timeout?: number }): Promise<unknown>;
  url(): string;
}

const READY = 'globalThis.game?.ready === true';

/**
 * Join the world as `user`. The password field is filled only when one is configured. If the
 * browser already holds a session, Foundry redirects away from /join and the form is skipped.
 */
export async function joinWorld(page: JoinPage, config: E2eConfig, user: string): Promise<void> {
  await page.goto(`${config.foundryUrl}/join`);
  if (page.url().includes('/join')) {
    try {
      await page.waitForSelector(SELECTORS.joinUser, { timeout: 15_000 });
    } catch {
      throw new Error(
        `no join form at ${config.foundryUrl}/join; is world ${config.world} launched?`,
      );
    }
    await page.selectOption(SELECTORS.joinUser, { label: user });
    if (config.password) await page.fill(SELECTORS.joinPassword, config.password);
    await page.click(SELECTORS.joinButton);
  }
  await page.waitForFunction(READY, undefined, { timeout: 120_000 });
}

/** JS source: a fixed banner and a title that keep the user name and the code visible. */
export function bannerScript(user: string, code: string): string {
  const text = `AGENT GATEWAY E2E SETUP - user: ${user} - type this pairing code: ${code}`;
  return `(() => {
    const text = ${JSON.stringify(text)};
    let el = document.getElementById('ag-e2e-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ag-e2e-banner';
      el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:10px;background:#b00020;color:#fff;font:bold 20px monospace;text-align:center';
      document.body.appendChild(el);
    }
    el.textContent = text;
    document.title = text;
    if (!window.__agE2eTitle) window.__agE2eTitle = setInterval(() => { document.title = text; }, 500);
  })()`;
}

export const OPEN_PAIRING_SCRIPT = `(() => {
  const menu = game.settings.menus.get(${JSON.stringify(PAIRING_MENU_KEY)});
  new menu.type().render(true);
})()`;

export const FOCUS_CODE_SCRIPT = `document.querySelector(${JSON.stringify(SELECTORS.pairingCode)})?.focus()`;

export const setGatewayUrlScript = (url: string): string =>
  `game.settings.set(${JSON.stringify(SETTINGS_NS)}, 'gatewayUrl', ${JSON.stringify(url)})`;

export interface UserBrowser {
  context: BrowserContext;
  page: Page;
  close(): Promise<void>;
}

/** One persistent profile per user; callers hold at most one open per user at a time. */
export async function openUserBrowser(
  config: E2eConfig,
  paths: E2ePaths,
  user: string,
  opts: { headed: boolean },
): Promise<UserBrowser> {
  const context = await chromium.launchPersistentContext(
    profileDir(paths, user),
    launchOptions(opts.headed),
  );
  const page = context.pages()[0] ?? (await context.newPage());
  return {
    context,
    page,
    close: () => context.close(),
  };
}

export async function foundryVersion(page: Page): Promise<string> {
  return String(await page.evaluate('game.version ?? game.data?.version ?? "unknown"'));
}
