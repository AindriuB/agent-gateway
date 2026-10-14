import { asJoinPage, joinWorld, openUserBrowser, type UserBrowser } from '../lib/browser.js';
import type { Context } from '../lib/context.js';
import { FrameCounter, waitFor } from './frames.js';
import { GatewayProcess } from '../lib/gateway.js';

/** How long a module may take to reconnect after a gateway swap (its backoff caps at 60 s). */
export const RECONNECT_MS = 100_000;

export interface OpenUser {
  user: string;
  browser: UserBrowser;
  frames: FrameCounter;
}

/**
 * Live rig for the multi-user suites: one gateway process at a time on the e2e port and DB, and
 * one browser per listed user (two at most). Browsers stay open while the gateway is swapped.
 */
export class Rig {
  gateway: GatewayProcess | undefined;
  readonly users = new Map<string, OpenUser>();

  constructor(readonly ctx: Context) {}

  /** Start a gateway (bound to `user`, or unbound), then open and join every browser. */
  async open(boundTo: string | undefined, users: readonly string[]): Promise<void> {
    await this.startGateway(boundTo);
    await this.joinAll(users);
  }

  private async joinAll(users: readonly string[]): Promise<void> {
    for (const user of users) {
      const frames = new FrameCounter(this.ctx.config.linkPort);
      const browser = await openUserBrowser(this.ctx.config, this.ctx.paths, user, {
        headed: this.ctx.config.headed,
      });
      this.users.set(user, { user, browser, frames });
      frames.attach(browser.page);
      await joinWorld(asJoinPage(browser.page), this.ctx.config, user);
    }
    await this.waitAllWelcomed(0, RECONNECT_MS);
  }

  /**
   * Like `open`, but the MCP client connects only after every page is welcomed, so the session's
   * first resolve sees all pairings connected (task 71: an earlier session would bind in follow mode).
   */
  async openThenConnect(boundTo: string | undefined, users: readonly string[]): Promise<void> {
    await this.startGateway(boundTo, { connectClient: false });
    await this.joinAll(users);
    await this.gateway!.connectClient();
  }

  frames(user: string): FrameCounter {
    const u = this.users.get(user);
    if (!u) throw new Error(`no open browser for ${user}`);
    return u.frames;
  }

  async startGateway(
    boundTo: string | undefined,
    opts?: { connectClient?: boolean },
  ): Promise<void> {
    const gw = new GatewayProcess(this.ctx.config, this.ctx.paths, boundTo);
    this.gateway = gw;
    await (opts ? gw.start(opts) : gw.start());
  }

  /** Stop the current gateway by its PID and start another on the same port and DB. */
  async swap(boundTo: string | undefined): Promise<number> {
    const before = new Map([...this.users].map(([k, u]) => [k, u.frames.welcomes]));
    const t0 = Date.now();
    await this.gateway?.stop();
    await this.startGateway(boundTo);
    await waitFor(
      () => [...this.users].every(([k, u]) => u.frames.welcomes > (before.get(k) ?? 0)),
      RECONNECT_MS,
    ).then((ms) => {
      if (ms === undefined)
        throw new Error(`a browser did not reconnect within ${RECONNECT_MS} ms`);
    });
    return Date.now() - t0;
  }

  private async waitAllWelcomed(atLeast: number, timeoutMs: number): Promise<void> {
    const ms = await waitFor(
      () => [...this.users.values()].every((u) => u.frames.welcomes > atLeast),
      timeoutMs,
    );
    if (ms === undefined) {
      throw new Error(
        `not every browser connected to the gateway within ${timeoutMs} ms; run npm run test:e2e:setup`,
      );
    }
  }

  /** Let in-flight frame events arrive, then return. */
  async settle(ms = 500): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  async close(): Promise<void> {
    for (const u of this.users.values()) await u.browser.close().catch(() => undefined);
    this.users.clear();
    await this.gateway?.stop();
    this.gateway = undefined;
  }
}
