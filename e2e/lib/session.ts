import type { E2eConfig, E2ePaths } from './config.js';
import {
  asJoinPage,
  foundryVersion,
  joinWorld,
  openUserBrowser,
  type UserBrowser,
} from './browser.js';
import { GatewayProcess, waitConnected } from './gateway.js';
import { ConnectBudgetError, connectWaitMs } from './wait.js';

export interface UserSession {
  user: string;
  gateway: GatewayProcess;
  browser: UserBrowser;
  info: Record<string, unknown>;
  foundryVersion: string;
  close(): Promise<void>;
}

/**
 * Start a gateway bound to `user`, open that user's stored profile, join, and wait for the
 * module to reconnect with its stored token. Never waits for input: a stale token fails within
 * `connectTimeoutMs` with the setup hint. Always releases the gateway and browser on failure.
 */
export async function openUserSession(
  config: E2eConfig,
  paths: E2ePaths,
  user: string,
  opts: { headed?: boolean; connectDeadlineAt?: number } = {},
): Promise<UserSession> {
  const gateway = new GatewayProcess(config, paths, user);
  let browser: UserBrowser | undefined;
  try {
    await gateway.start();
    browser = await openUserBrowser(config, paths, user, { headed: opts.headed ?? config.headed });
    await joinWorld(asJoinPage(browser.page), config, user);
    const waitMs =
      opts.connectDeadlineAt === undefined
        ? config.connectTimeoutMs
        : connectWaitMs(opts.connectDeadlineAt, Date.now(), config.connectTimeoutMs);
    if (waitMs <= 0) throw new ConnectBudgetError(user);
    const info = await waitConnected(gateway, waitMs);
    const version = await foundryVersion(browser.page);
    const b = browser;
    return {
      user,
      gateway,
      browser: b,
      info,
      foundryVersion: version,
      close: async () => {
        await b.close().catch(() => undefined);
        await gateway.stop();
      },
    };
  } catch (err) {
    await browser?.close().catch(() => undefined);
    await gateway.stop();
    throw err;
  }
}
