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
  /** The relayed secondary from `openWithRelayedSession`; its MCP session is created on attach. */
  relayed: GatewayProcess | undefined;
  readonly users = new Map<string, OpenUser>();

  constructor(readonly ctx: Context) {}

  /** Start a gateway (bound to `user`, or unbound), then open and join every browser. */
  async open(boundTo: string | undefined, users: readonly string[]): Promise<void> {
    await this.startGateway(boundTo);
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
   * Open every page against a primary, wait for all welcomes, then start a second, identical
   * gateway. It relays to the primary, and its MCP session is created on attach with every pairing
   * already connected, so its first resolve is ambiguous (task 71). The primary's own stdio session
   * binds to the first page in follow mode and is ignored. Returns the secondary.
   */
  async openWithRelayedSession(users: readonly string[]): Promise<GatewayProcess> {
    await this.open(undefined, users);
    const s = new GatewayProcess(this.ctx.config, this.ctx.paths, undefined);
    this.relayed = s; // assigned first so close() reaps it even if start() or the check below fails
    await s.start();
    const ok = await waitFor(() => /relays to it/.test(s.stderr), 30_000);
    if (ok === undefined) {
      throw new Error(`the second gateway did not settle as a relaying secondary:\n${s.stderr}`);
    }
    return s;
  }

  frames(user: string): FrameCounter {
    const u = this.users.get(user);
    if (!u) throw new Error(`no open browser for ${user}`);
    return u.frames;
  }

  async startGateway(boundTo: string | undefined): Promise<void> {
    const gw = new GatewayProcess(this.ctx.config, this.ctx.paths, boundTo);
    await gw.start();
    this.gateway = gw;
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
    await this.relayed?.stop();
    this.relayed = undefined;
    await this.gateway?.stop();
    this.gateway = undefined;
  }
}
