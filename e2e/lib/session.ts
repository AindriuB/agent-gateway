import type { E2eConfig, E2ePaths } from './config.js';
import {
  asJoinPage,
  foundryVersion,
  joinWorld,
  openUserBrowser,
  type UserBrowser,
} from './browser.js';
import { GatewayProcess, waitConnected } from './gateway.js';
import { Deadline } from './wait.js';

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
 * module to reconnect with its stored token. Never waits for input. With `connectDeadlineAt` every
 * step runs inside that shared deadline, so a stale token fails by it with the setup hint. Always
 * releases the gateway and browser on failure.
 */
export async function openUserSession(
  config: E2eConfig,
  paths: E2ePaths,
  user: string,
  opts: { headed?: boolean; connectDeadlineAt?: number } = {},
): Promise<UserSession> {
  const gateway = new GatewayProcess(config, paths, user);
  let browser: UserBrowser | undefined;
  // With a shared deadline every startup step runs inside it; without one (setup, the suites)
  // each step keeps its own timeout.
  const deadline =
    opts.connectDeadlineAt === undefined ? undefined : new Deadline(opts.connectDeadlineAt);
  const step = <T>(stage: string, fn: (remainingMs?: number) => Promise<T>): Promise<T> =>
    deadline ? deadline.run(user, stage, (ms) => fn(ms)) : fn(undefined);
  // A step that loses the race keeps running; hold its promise so cleanup can reap what it made.
  let starting: Promise<void> | undefined;
  let launching: Promise<UserBrowser> | undefined;
  try {
    starting = gateway.start();
    await step('starting the gateway', () => starting as Promise<void>);
    launching = openUserBrowser(config, paths, user, { headed: opts.headed ?? config.headed });
    const b = await step('launching the browser', () => launching as Promise<UserBrowser>);
    browser = b;
    await step('joining the world', (ms) => joinWorld(asJoinPage(b.page), config, user, ms));
    const info = await step('waiting for the module to connect', (ms) =>
      waitConnected(gateway, Math.min(config.connectTimeoutMs, ms ?? config.connectTimeoutMs)),
    );
    const version = await step('reading the Foundry version', () => foundryVersion(b.page));
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
    // Bounded cleanup (2 s in all), so a failure is still reported inside the 45 s bound. A
    // launch or start that lost the race is reaped when it settles.
    void launching?.then((late) => (late === browser ? undefined : late.close())).catch(() => {});
    await withinMs(browser?.close(), 1000);
    await withinMs(
      (starting ?? Promise.resolve()).then(() => gateway.stop()),
      1000,
    );
    void starting?.then(() => gateway.stop()).catch(() => {});
    throw err;
  }
}

/** Wait for `p` at most `ms`; errors are ignored (cleanup only). */
async function withinMs(p: Promise<unknown> | undefined, ms: number): Promise<void> {
  if (!p) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    p.catch(() => undefined),
    new Promise<void>((r) => {
      timer = setTimeout(r, ms);
    }),
  ]);
  clearTimeout(timer);
}
