import { safeText } from '../routing/sanitize.js';
import { canonicalOrigin } from '../link/origin.js';
import { HEADLESS_FLAG_KEY } from './flag.js';
import { ensureProfileDir } from './profile.js';
import type { HeadlessInvites } from './invites.js';

/** How often `/api/status` is polled. */
export const STATUS_POLL_MS = 15_000;
/** Consecutive failed polls before the browser is closed. */
export const STATUS_FAILURES_BEFORE_CLOSE = 3;
/** After `replaced`, the runner leaves the slot alone for this long (or until the next world start). */
export const REPLACED_PAUSE_MS = 5 * 60_000;
/** How long a page may take to connect with the token it already holds before an invite is minted. */
export const LINK_GRACE_MS = 15_000;
/** How long the gateway waits for the link after typing an invite. */
export const PAIR_WAIT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;
const JOIN_TIMEOUT_MS = 120_000;

/** The only paths the runner itself requests. */
export const RUNNER_PATHS = ['/api/status', '/join', '/game'] as const;

export const SELECTORS = {
  // v13 uses `userid`; v14 uses `userId`.
  joinUser: 'select:is([name="userId"], [name="userid"])',
  joinPassword: 'input[name="password"]',
  joinButton: 'button[name="join"]',
  pairingGatewayUrl: '#agent-gateway-pairing input[name="gatewayUrl"]',
  pairingCode: '#agent-gateway-pairing input[name="code"]',
  pairingSubmit: '#agent-gateway-pairing button[type="submit"]',
} as const;

const OPEN_PAIRING_SCRIPT = `(() => {
  const menu = game.settings.menus.get('agent-gateway.pairing');
  new menu.type().render(true);
})()`;

/** The slice of a browser page the runner drives; a fake implements it in tests. */
export interface RunnerPage {
  goto(url: string, opts: { timeout: number }): Promise<void>;
  /** The page's current URL. */
  url(): string;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<void>;
  selectOption(selector: string, option: { value: string }): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  evaluate(script: string): Promise<unknown>;
  waitForGameReady(timeoutMs: number): Promise<void>;
}

/** A browser context with one page. `close` never touches the profile dir. */
export interface RunnerBrowser {
  page: RunnerPage;
  close(): Promise<void>;
}

export interface LaunchRequest {
  profileDir: string;
  /** JS run in every page before Foundry loads. */
  initScript: string;
}

export interface BrowserLauncher {
  launch(req: LaunchRequest): Promise<RunnerBrowser>;
}

export interface HeadlessAgent {
  /** The Foundry URL as the operator gave it, without a trailing slash. */
  foundryUrl: string;
  worldId: string;
  userId: string;
  password: string;
}

export interface RunnerOptions {
  agent: HeadlessAgent;
  stateDir: string;
  /** `ws://localhost:<port>`: where the runner's page reaches this gateway. */
  gatewayLinkUrl: string;
  invites: HeadlessInvites;
  launcher: BrowserLauncher;
  /** Is the agent's link connected right now? */
  isLinked(): boolean;
  log(line: string): void;
  fetch?: typeof fetch;
  now?: () => number;
  pollMs?: number;
  linkGraceMs?: number;
  pairWaitMs?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms).unref());

/**
 * Runs the one agent: follows the world's lifecycle by polling `/api/status`, never launches a
 * world, and never touches a setup or admin endpoint.
 */
export class HeadlessRunner {
  private browser: RunnerBrowser | undefined;
  private timer: unknown;
  private stopped = false;
  private failures = 0;
  private busy: Promise<void> | undefined;
  private pausedUntil = 0;
  private worldWasUp = false;
  private readonly origin: string;
  private readonly profile: string | undefined;
  private profileProblem: string | undefined;

  constructor(private readonly o: RunnerOptions) {
    this.origin = canonicalOrigin(new URL(o.agent.foundryUrl).origin) ?? '';
    const p = ensureProfileDir(o.stateDir, o.agent.worldId, o.agent.userId);
    if (p.ok) this.profile = p.dir;
    else this.profileProblem = p.reason;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  private who(): string {
    return `${safeText(this.o.agent.worldId)}/${safeText(this.o.agent.userId)}`;
  }

  /** Begin polling. False (and a log line) when the profile directory cannot be used. */
  start(): boolean {
    if (this.profile === undefined) {
      this.o.log(
        `headless runner for ${this.who()} will not start: ${safeText(this.profileProblem ?? '')}`,
      );
      return false;
    }
    this.stopped = false;
    this.timer = (this.o.setInterval ?? ((fn, ms) => setInterval(fn, ms).unref()))(
      () => void this.tick(),
      this.o.pollMs ?? STATUS_POLL_MS,
    );
    void this.tick();
    return true;
  }

  /** Close the browser context and stop polling. The profile stays on disk. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined)
      (this.o.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout)))(this.timer);
    this.timer = undefined;
    this.o.invites.dropAgent(this.o.agent.worldId, this.o.agent.userId);
    await this.closeBrowser();
    await this.busy?.catch(() => undefined);
    // A start that was in flight when stop() ran may have opened a browser since.
    await this.closeBrowser();
  }

  /** The agent's link was closed with `replaced`: stand down instead of fighting for the slot. */
  replaced(userName: string): void {
    if (this.browser === undefined || this.stopped) return;
    this.pausedUntil = this.now() + REPLACED_PAUSE_MS;
    this.o.log(
      `agent user ${safeText(userName)} was taken by another client; the runner is paused`,
    );
  }

  /** One poll, run to completion; overlapping calls share the running one. */
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.busy ??= this.poll()
      .catch((err: unknown) =>
        this.o.log(`headless runner: ${safeText((err as Error).message ?? String(err))}`),
      )
      .finally(() => {
        this.busy = undefined;
      });
    return this.busy;
  }

  private async worldActive(): Promise<boolean | undefined> {
    try {
      const res = await (this.o.fetch ?? fetch)(`${this.o.agent.foundryUrl}/api/status`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { active?: unknown; world?: unknown };
      if (body.active !== true) return false;
      return typeof body.world !== 'string' || body.world === this.o.agent.worldId;
    } catch {
      return undefined;
    }
  }

  private async poll(): Promise<void> {
    const active = await this.worldActive();
    if (this.stopped) return;
    if (active === undefined) {
      if (++this.failures >= STATUS_FAILURES_BEFORE_CLOSE && this.browser) {
        this.o.log(
          `headless runner: Foundry status failed ${this.failures} times; closing browser`,
        );
        await this.closeBrowser();
      }
      return;
    }
    this.failures = 0;
    if (!active) {
      this.worldWasUp = false;
      this.pausedUntil = 0;
      if (this.browser) {
        this.o.log(
          `headless runner: world ${safeText(this.o.agent.worldId)} is down; closing browser`,
        );
        await this.closeBrowser();
      }
      return;
    }
    if (!this.worldWasUp) {
      // A fresh world start ends any pause.
      this.worldWasUp = true;
      this.pausedUntil = 0;
    }
    if (this.browser === undefined) {
      await this.openSession();
    } else if (this.pausedUntil !== 0) {
      if (this.now() < this.pausedUntil) return;
      this.pausedUntil = 0;
      if (this.o.isLinked()) return;
      await this.closeBrowser();
      await this.openSession();
    }
    if (this.browser && !this.stopped && !this.o.isLinked()) await this.ensureLinked();
  }

  private async closeBrowser(): Promise<void> {
    const b = this.browser;
    this.browser = undefined;
    if (b) await b.close().catch(() => undefined);
  }

  private async openSession(): Promise<void> {
    const { agent } = this.o;
    const browser = await this.o.launcher.launch({
      profileDir: this.profile!,
      initScript: `try { sessionStorage.setItem(${JSON.stringify(HEADLESS_FLAG_KEY)}, '1'); } catch {}`,
    });
    if (this.stopped) {
      await browser.close().catch(() => undefined);
      return;
    }
    this.browser = browser;
    const { page } = browser;
    try {
      await page.goto(`${agent.foundryUrl}/join`, { timeout: 60_000 });
      if (page.url().includes('/join')) {
        await page.waitForSelector(SELECTORS.joinUser, { timeout: 15_000 });
        await page.selectOption(SELECTORS.joinUser, { value: agent.userId });
        if (agent.password) await page.fill(SELECTORS.joinPassword, agent.password);
        await page.click(SELECTORS.joinButton);
      }
      await page.waitForGameReady(JOIN_TIMEOUT_MS);
    } catch (err) {
      this.o.log(
        `headless runner: could not join ${safeText(agent.worldId)} as ${safeText(agent.userId)}: ${safeText((err as Error).message)}`,
      );
      await this.closeBrowser();
    }
  }

  private async waitLinked(ms: number): Promise<boolean> {
    const sleep = this.o.sleep ?? realSleep;
    const step = Math.min(250, Math.max(1, ms));
    for (let left = ms; left > 0 && !this.stopped; left -= step) {
      if (this.o.isLinked()) return true;
      await sleep(step);
    }
    return this.o.isLinked();
  }

  /** A stored token connects on its own; only without one is an invite minted and typed. */
  private async ensureLinked(): Promise<void> {
    const page = this.browser?.page;
    if (!page) return;
    if (await this.waitLinked(this.o.linkGraceMs ?? LINK_GRACE_MS)) return;
    if (this.stopped || this.browser?.page !== page) return;
    const { agent } = this.o;
    const code = this.o.invites.mint(agent.worldId, agent.userId, this.origin);
    if (code === undefined) {
      this.o.log(`headless agent ${this.who()} is not active; no invite minted`);
      return;
    }
    this.o.log(`minted an invite for headless agent ${this.who()} (redacted)`);
    try {
      await page.evaluate(OPEN_PAIRING_SCRIPT);
      await page.waitForSelector(SELECTORS.pairingCode, { timeout: 15_000 });
      await page.fill(SELECTORS.pairingGatewayUrl, this.o.gatewayLinkUrl);
      await page.fill(SELECTORS.pairingCode, code);
      await page.click(SELECTORS.pairingSubmit);
    } catch (err) {
      this.o.invites.dropAgent(agent.worldId, agent.userId);
      this.o.log(
        `headless runner: could not enter the invite: ${safeText((err as Error).message)}`,
      );
      return;
    }
    if (!(await this.waitLinked(this.o.pairWaitMs ?? PAIR_WAIT_MS)))
      this.o.log(`headless agent ${this.who()} did not connect after the invite was entered`);
  }
}
