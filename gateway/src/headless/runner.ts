import { safeText } from '../routing/sanitize.js';
import { canonicalOrigin } from '../link/origin.js';
import { HEADLESS_FLAG_KEY, HEADLESS_LINK_KEY } from './flag.js';
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
/** How long `stop()` waits for in-flight work (a launch, a login step, a close) before moving on. */
export const STOP_WAIT_MS = 3_000;
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
  /** Calls `cb` once if the browser, context or page closes or disconnects on its own. */
  onClosed?(cb: () => void): void;
  /** True when the browser, context or page is already gone. */
  isClosed?(): boolean;
}

/** Resolves with `p`, or with undefined after `ms` (the timer never keeps the process alive). */
function bounded<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    t.unref();
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      () => (clearTimeout(t), resolve(undefined)),
    );
  });
}

/** Thrown inside a session step when `stop()` (or a newer session) has taken over. */
class Abandoned extends Error {}

export interface LaunchRequest {
  profileDir: string;
  /** JS run in every page before Foundry loads. */
  initScript: string;
  /** Run Chromium without its sandbox (`headlessNoSandbox` in the config). */
  noSandbox: boolean;
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
  /** Launch Chromium without its sandbox (`headlessNoSandbox` in the config). */
  noSandbox?: boolean;
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
  private gen = 0;
  private deadLogged = false;
  private abort = new AbortController();
  private replacedLogged = false;
  private failures = 0;
  private statusFailureLogged = false;
  private notInstalledLogged = false;
  private sandboxLogged = false;
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
    this.abort = new AbortController();
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
    this.gen++;
    this.abort.abort();
    if (this.timer !== undefined)
      (this.o.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout)))(this.timer);
    this.timer = undefined;
    this.o.invites.dropAgent(this.o.agent.worldId, this.o.agent.userId);
    // One deadline for every wait below, measured from now: each wait gets only what is left.
    const deadline = Date.now() + STOP_WAIT_MS;
    const left = (): number => Math.max(0, deadline - Date.now());
    await bounded(this.closeBrowser(), left());
    const busy = this.busy;
    if (busy) {
      await bounded(busy, left());
      // Whatever is still pending is abandoned: a late browser is closed by its own step.
      if (this.busy === busy) this.busy = undefined;
    }
    // A start that was in flight when stop() ran may have opened a browser since.
    await bounded(this.closeBrowser(), left());
  }

  /**
   * Did another client take the agent's slot? The runner's own page says so: its module stops for
   * good with `REPLACED` and mirrors that into session storage. Pauses (and logs once per browser).
   */
  private async checkReplaced(): Promise<void> {
    const page = this.browser?.page;
    if (!page) return;
    let v: unknown;
    try {
      v = await page.evaluate(
        `(() => { try { return sessionStorage.getItem(${JSON.stringify(HEADLESS_LINK_KEY)}); } catch { return null; } })()`,
      );
    } catch {
      return;
    }
    if (v !== 'replaced' || this.stopped || this.browser?.page !== page) return;
    this.pausedUntil = this.now() + REPLACED_PAUSE_MS;
    if (this.replacedLogged) return;
    this.replacedLogged = true;
    this.o.log(
      `agent user ${safeText(this.o.agent.userId)} was taken by another client; the runner is paused`,
    );
  }

  /** One poll, run to completion; overlapping calls share the running one. */
  tick(): Promise<void> {
    if (this.stopped || this.profile === undefined) return Promise.resolve();
    this.busy ??= this.poll()
      .catch((err: unknown) => {
        const msg = safeText((err as Error).message ?? String(err));
        if (msg.startsWith('playwright-core is not installed')) {
          if (this.notInstalledLogged) return;
          this.notInstalledLogged = true;
        }
        if (msg.startsWith('Chromium could not start with its sandbox')) {
          if (this.sandboxLogged) return;
          this.sandboxLogged = true;
        }
        this.o.log(`headless runner: ${msg}`);
      })
      .finally(() => {
        if (this.busy === mine) this.busy = undefined;
      });
    const mine = this.busy;
    return this.busy;
  }

  private statusFailed(reason: string): undefined {
    if (!this.stopped && !this.statusFailureLogged) {
      this.statusFailureLogged = true;
      this.o.log(
        `headless runner: cannot read ${safeText(this.o.agent.foundryUrl)}/api/status: ${safeText(reason)}`,
      );
    }
    return undefined;
  }

  private async worldActive(): Promise<boolean | undefined> {
    try {
      const res = await (this.o.fetch ?? fetch)(`${this.o.agent.foundryUrl}/api/status`, {
        signal: AbortSignal.any([AbortSignal.timeout(STATUS_TIMEOUT_MS), this.abort.signal]),
      });
      if (!res.ok) return this.statusFailed(`HTTP ${res.status}`);
      const body = (await res.json()) as { active?: unknown; world?: unknown };
      if (body.active !== true) return false;
      return typeof body.world !== 'string' || body.world === this.o.agent.worldId;
    } catch (err) {
      const e = err as { message?: string; cause?: { code?: string; message?: string } };
      const cause = e.cause?.code ?? e.cause?.message;
      return this.statusFailed(`${e.message ?? String(err)}${cause ? ` (${cause})` : ''}`);
    }
  }

  private async poll(): Promise<void> {
    this.dropDeadBrowser();
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
    if (this.statusFailureLogged) {
      this.statusFailureLogged = false;
      this.o.log('headless runner: Foundry status is readable again');
    }
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
      if (this.pausedUntil !== 0 && this.now() < this.pausedUntil) return;
      // The pause (if any) has expired: this poll launches once.
      this.pausedUntil = 0;
      await this.openSession();
    } else {
      if (this.pausedUntil === 0) await this.checkReplaced();
    }
    if (this.browser !== undefined && this.pausedUntil !== 0) {
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
    this.replacedLogged = false;
    if (b) await bounded(b.close(), STOP_WAIT_MS);
  }

  /** The held browser died on its own: forget it (and say so once) so the next poll relaunches. */
  private dropDeadBrowser(b: RunnerBrowser | undefined = this.browser): void {
    if (!b || this.browser !== b || this.stopped) return;
    if (!b.isClosed?.()) return;
    this.browser = undefined;
    this.replacedLogged = false;
    void b.close().catch(() => undefined);
    if (this.deadLogged) return;
    this.deadLogged = true;
    this.o.log(
      `headless runner: the browser for ${this.who()} closed unexpectedly; it will be relaunched`,
    );
  }

  private async openSession(): Promise<void> {
    const { agent } = this.o;
    const gen = this.gen;
    const browser = await this.o.launcher.launch({
      profileDir: this.profile!,
      noSandbox: this.o.noSandbox === true,
      initScript: `try { sessionStorage.setItem(${JSON.stringify(HEADLESS_FLAG_KEY)}, '1'); } catch {}`,
    });
    if (this.stopped || this.gen !== gen) {
      // stop() has returned (or a newer session began) while this launch was pending: never use it.
      void browser.close().catch(() => undefined);
      return;
    }
    this.browser = browser;
    this.deadLogged = false;
    browser.onClosed?.(() => this.dropDeadBrowser(browser));
    const { page } = browser;
    const live = (): void => {
      if (this.stopped || this.gen !== gen || this.browser !== browser) throw new Abandoned();
    };
    try {
      await page.goto(`${agent.foundryUrl}/join`, { timeout: 60_000 });
      live();
      if (page.url().includes('/join')) {
        await page.waitForSelector(SELECTORS.joinUser, { timeout: 15_000 });
        live();
        await page.selectOption(SELECTORS.joinUser, { value: agent.userId });
        live();
        if (agent.password) {
          // Playwright puts the filled value in its error text: log a fixed message instead.
          try {
            await page.fill(SELECTORS.joinPassword, agent.password);
          } catch {
            throw new Error('could not type the password');
          }
          live();
        }
        await page.click(SELECTORS.joinButton);
        live();
      }
      await page.waitForGameReady(JOIN_TIMEOUT_MS);
    } catch (err) {
      if (err instanceof Abandoned || this.stopped || this.gen !== gen) return;
      if (this.browser !== browser) {
        // It died mid-join; dropDeadBrowser has already logged it.
        return;
      }
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
    const gen = this.gen;
    const live = (): boolean => !this.stopped && this.gen === gen && this.browser?.page === page;
    if (await this.waitLinked(this.o.linkGraceMs ?? LINK_GRACE_MS)) return;
    if (!live()) return;
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
      try {
        await page.fill(SELECTORS.pairingCode, code);
      } catch {
        throw new Error('could not type the invite code');
      }
      await page.click(SELECTORS.pairingSubmit);
    } catch (err) {
      this.o.invites.dropAgent(agent.worldId, agent.userId);
      // Stopped, replaced or dead mid-invite: the browser's own close is the story, not this.
      if (!live()) return;
      this.o.log(
        `headless runner: could not enter the invite: ${safeText((err as Error).message)}`,
      );
      return;
    }
    if (!(await this.waitLinked(this.o.pairWaitMs ?? PAIR_WAIT_MS)) && live())
      this.o.log(`headless agent ${this.who()} did not connect after the invite was entered`);
  }
}
