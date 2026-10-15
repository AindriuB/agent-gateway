import type { Readable, Writable } from 'node:stream';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { safeText, type UserSelector } from '../routing/index.js';
import { clearClaim, readClaim } from './claim.js';
import {
  RELAY_BACKOFF_CAP_MS,
  RELAY_BACKOFF_START_MS,
  RELAY_CAP_HEADLESS,
  RELAY_CLAIM_SLACK_MS,
  RELAY_CONNECT_ATTEMPTS,
  RELAY_TAKEOVER_DEADLINE_MS,
  STEPDOWN_GRACE_MS,
} from './constants.js';
import { describeConfigDiff, type RelayConfig } from './config.js';
import { StdioRelayProxy } from './proxy.js';
import { connectRelay, LocalUpstream, type Upstream } from './upstream.js';

export interface SecondaryOptions {
  endpoint: string;
  stateDir: string;
  linkPort: number;
  selector: UserSelector;
  /** This instance's role and origins; the primary must agree or it will not serve us. */
  config: RelayConfig;
  input: Readable;
  output: Writable;
  log: (line: string) => void;
  /**
   * Try to become the primary, serving the client on `transport`. True means this instance now
   * holds the link port; false means someone else does. May throw for a real failure.
   */
  becomePrimary(transport: Transport): Promise<boolean>;
  /** The degraded session to serve once the relay budget is spent. */
  createDegraded(reason: string): Server;
  /** The standby session: a primary with other settings holds the link; this instance waits. */
  createStandby?(reason: string): Server;
  /**
   * Reuse the stdio proxy of a primary that is stepping down, so its client keeps one session.
   * It must already be started; the secondary takes over its `onLost` and `onClientGone`.
   */
  proxy?: StdioRelayProxy;
  /** The role is final (relay, standby or degraded); `reason` says why it is not the primary. */
  onSettled?: (role: 'relay' | 'standby' | 'degraded', reason: string) => void;
  /** The client stopped reading stdout past the cap and its session was dropped. */
  onClientGone?: () => void;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
}

const TOO_OLD =
  'primary too old, headless agent not running: the gateway holding the link port does not understand headless settings; upgrade or stop it';

const describe = (s: UserSelector | undefined) =>
  `world=${safeText(s?.world || '(any)')} user=${safeText(s?.user || '(any)')}`;

/**
 * A gateway instance that lost the race for the link port. It forwards its stdio MCP traffic to
 * the primary over the relay, and if the primary goes away it tries to take over, within a fixed
 * attempt budget, before settling for the degraded server.
 */
export class RelaySecondary {
  private readonly proxy: StdioRelayProxy;
  private stopped = false;
  /**
   * Only a relay may recover, and only a standby keeps watching the link port; a process that
   * holds the link, or is degraded, never re-runs startup.
   */
  private role: 'relay' | 'primary' | 'standby' | 'degraded' = 'relay';
  private local: Server | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private demoting = false;
  /** A demoted primary has a live client session to keep, so it never settles for degraded. */
  private demoted = false;
  private watching = false;
  private standbyReason = '';

  constructor(private readonly opts: SecondaryOptions) {
    this.proxy = opts.proxy ?? new StdioRelayProxy(opts.input, opts.output, opts.log);
    this.proxy.onLost = () => void this.recover();
    this.proxy.onClientGone = () => this.opts.onClientGone?.();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get currentRole(): 'relay' | 'primary' | 'standby' | 'degraded' {
    return this.role;
  }

  /** Resolves once the client is attached to something: the relay, or the degraded server. */
  async start(failedWith: string): Promise<void> {
    const outcome = await this.acquire(false, failedWith);
    if (this.stopped) {
      if (outcome.kind === 'upstream') outcome.upstream.close();
      return;
    }
    this.proxy.start();
    await this.settle(outcome);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.proxy.stop();
    await this.local?.close();
    this.local = undefined;
  }

  /**
   * This process was the primary and must step down. `teardown` releases everything the primary
   * held (link, http, store); the client's session survives on the same proxy and moves to the
   * new primary, or to a standby that waits to take over. One demotion runs at a time.
   */
  async demote(reason: string, teardown: () => Promise<void>): Promise<void> {
    if (this.demoting || this.stopped) return;
    this.demoting = true;
    this.demoted = true;
    try {
      // The old session closing is expected: its in-flight calls get RELAY_LOST, nothing recovers.
      this.proxy.onLost = undefined;
      await teardown();
      this.role = 'relay';
      this.proxy.onLost = () => void this.recover();
      if (this.stopped) return;
      const outcome = await this.acquire(false, reason);
      if (this.stopped) {
        if (outcome.kind === 'upstream') outcome.upstream.close();
        return;
      }
      await this.settle(outcome);
    } finally {
      this.demoting = false;
    }
  }

  private async settle(outcome: Outcome): Promise<void> {
    if (outcome.kind === 'upstream') {
      this.proxy.attach(outcome.upstream);
      if (this.role === 'relay') this.opts.onSettled?.('relay', outcome.note ?? 'relaying');
    } else if (outcome.kind === 'standby') await this.serveStandby(outcome.reason);
    else await this.serveDegraded(outcome.reason);
  }

  private async recover(): Promise<void> {
    if (this.stopped || this.demoting) return;
    if (this.role !== 'relay') {
      this.opts.log(`the ${this.role} session ended; not re-running startup`);
      return;
    }
    this.opts.log('the primary gateway went away; trying to take over or reconnect');
    const outcome = await this.acquire(true, 'the primary gateway went away');
    if (this.stopped) {
      if (outcome.kind === 'upstream') outcome.upstream.close();
      return;
    }
    await this.settle(outcome);
  }

  private async serveLocal(server: Server): Promise<void> {
    this.local = server;
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const up = new LocalUpstream(b);
    await up.start();
    this.proxy.attach(up);
  }

  private async serveDegraded(reason: string): Promise<void> {
    this.role = 'degraded';
    this.opts.log(`relay unavailable, serving gateway_status only: ${reason}`);
    await this.serveLocal(this.opts.createDegraded(reason));
    this.opts.onSettled?.('degraded', reason);
  }

  private async serveStandby(reason: string): Promise<void> {
    this.role = 'standby';
    this.standbyReason = reason;
    this.opts.log(`standby: ${reason}`);
    await this.serveLocal((this.opts.createStandby ?? this.opts.createDegraded)(reason));
    this.opts.onSettled?.('standby', reason);
    void this.watchStandby();
  }

  /**
   * Re-check the link port with the relay backoff and no attempt cap, holding nothing between
   * checks: take over when it is free, or relay if the holder now accepts this configuration.
   */
  private async watchStandby(): Promise<void> {
    if (this.watching) return;
    this.watching = true;
    let delay = RELAY_BACKOFF_START_MS;
    try {
      while (!this.stopped && this.role === 'standby') {
        await this.sleep(delay);
        delay = Math.min(delay * 2, RELAY_BACKOFF_CAP_MS);
        if (this.stopped) return;
        const [a, b] = InMemoryTransport.createLinkedPair();
        try {
          if (await this.tryBind(a)) {
            this.role = 'primary';
            const up = new LocalUpstream(b);
            await up.start();
            await this.leaveStandby(up);
            return;
          }
        } catch (err) {
          this.opts.log(`takeover failed: ${safeText((err as Error).message)}`);
        }
        void b.close();
        if (this.stopped) return;
        const r = await connectRelay(this.opts);
        if (r.kind === 'ok' && this.tooOld(r.caps)) {
          r.upstream.close();
          await this.refreshStandby(TOO_OLD);
          continue;
        }
        if (r.kind === 'ok') {
          this.role = 'relay';
          await this.leaveStandby(r.upstream);
          this.opts.onSettled?.('relay', 'the primary now accepts this configuration');
          return;
        }
      }
    } finally {
      this.watching = false;
    }
  }

  /** The standby's reason went stale (the port holder changed): serve and report the new one, once. */
  private async refreshStandby(reason: string): Promise<void> {
    if (this.stopped || this.role !== 'standby' || this.standbyReason === reason) return;
    this.standbyReason = reason;
    this.opts.log(`standby: ${reason}`);
    const old = this.local;
    await this.serveLocal((this.opts.createStandby ?? this.opts.createDegraded)(reason));
    await old?.close();
    this.opts.onSettled?.('standby', reason);
  }

  private async leaveStandby(next: Upstream): Promise<void> {
    if (this.stopped) {
      next.close();
      return;
    }
    // Attach first: the proxy ignores the standby session's close once another is live.
    this.proxy.attach(next);
    const old = this.local;
    this.local = undefined;
    await old?.close();
  }

  private async acquire(tryPrimary: boolean, failedWith: string): Promise<Outcome> {
    let last = failedWith;
    // Set once a primary agrees to step down for us: from then on we also try to take its place.
    let takeOver = tryPrimary;
    let delay = RELAY_BACKOFF_START_MS;
    let stepDownDeadline: number | undefined;
    for (let attempt = 1; attempt <= RELAY_CONNECT_ATTEMPTS && !this.stopped; attempt++) {
      if (takeOver) {
        const [a, b] = InMemoryTransport.createLinkedPair();
        try {
          if (await this.tryBind(a)) {
            this.role = 'primary';
            const up = new LocalUpstream(b);
            await up.start();
            return { kind: 'upstream', upstream: up };
          }
        } catch (err) {
          last = `takeover failed: ${safeText((err as Error).message)}`;
          this.opts.log(last);
        }
        void b.close();
      }
      const r = await connectRelay(this.opts);
      if (r.kind === 'ok' && this.tooOld(r.caps)) {
        r.upstream.close();
        return { kind: 'standby', reason: TOO_OLD };
      }
      if (r.kind === 'ok') {
        this.role = 'relay';
        return {
          kind: 'upstream',
          upstream: r.upstream,
          note: this.demoted ? 'relaying to the gateway that replaced this primary' : 'relaying',
        };
      }
      if (r.kind === 'refused') {
        if (r.code === 'RELAY_SELECTOR_MISMATCH')
          return this.blocked(
            `the primary gateway refused this instance: selector mismatch (this instance: ${describe(this.opts.selector)}; primary: ${describe(r.selector)})`,
          );
        if (r.code === 'RELAY_CONFIG_MISMATCH') {
          const diff = describeConfigDiff(this.opts.config, r.config, true);
          // A newer plain caller refused by a headless primary: it is kept for its agent, not for its age.
          const keptForAgent =
            !!r.config && r.config.headless !== '' && this.opts.config.headless === '';
          return {
            kind: 'standby',
            reason: keptForAgent
              ? `the primary gateway has different session settings (${diff}) and is kept because it runs a headless agent`
              : `the primary gateway has different session settings (${diff}) and is not older than this instance, so it is left running`,
          };
        }
        if (r.code === 'RELAY_CONFIG_STEPDOWN') {
          this.opts.log('the primary gateway has an older configuration and is stepping down');
          takeOver = true;
          last = 'waiting for the older gateway to step down';
          // Being handed a STEPDOWN means an older instance holds the port and will release it:
          // that is not a failed attempt. Without this, a run of older instances winning the port
          // would use up the budget and leave this, the newest instance, degraded. A separate
          // deadline bounds the wait.
          stepDownDeadline ??= Date.now() + RELAY_TAKEOVER_DEADLINE_MS;
          if (Date.now() < stepDownDeadline) {
            attempt--;
            delay = RELAY_BACKOFF_START_MS;
          }
        } else if (r.code !== 'RELAY_AUTH' && r.code !== 'RELAY_FULL')
          return this.blocked(`the primary gateway refused the relay: ${safeText(String(r.code))}`);
        if (r.code !== 'RELAY_CONFIG_STEPDOWN')
          last = `the primary gateway refused the relay: ${safeText(String(r.code))}`;
      } else {
        last = r.reason;
      }
      if (attempt < RELAY_CONNECT_ATTEMPTS) {
        await this.sleep(delay);
        delay = Math.min(delay * 2, RELAY_BACKOFF_CAP_MS);
      }
    }
    const reason = `could not relay to the gateway holding link port ${this.opts.linkPort} after ${RELAY_CONNECT_ATTEMPTS} attempts: ${last}`;
    return this.blocked(reason);
  }

  /** A caller with headless settings must not relay to a primary that would ignore them. */
  private tooOld(caps: readonly string[]): boolean {
    return this.opts.config.headless !== '' && !caps.includes(RELAY_CAP_HEADLESS);
  }

  /** A primary is handing the link port to another instance right now: leave the bind to it. */
  private claimedByOther(): boolean {
    const c = readClaim(this.opts.stateDir, this.opts.linkPort);
    if (!c || c.heir === this.opts.config.startedAt) return false;
    const age = Date.now() - c.at;
    return age >= 0 && age < STEPDOWN_GRACE_MS + RELAY_CLAIM_SLACK_MS;
  }

  /** Try to bind the link port, unless another instance holds the claim to it. */
  private async tryBind(transport: Transport): Promise<boolean> {
    if (this.claimedByOther()) return false;
    const won = await this.opts.becomePrimary(transport);
    if (won) {
      const c = readClaim(this.opts.stateDir, this.opts.linkPort);
      if (c?.heir === this.opts.config.startedAt)
        clearClaim(this.opts.stateDir, this.opts.linkPort);
    }
    return won;
  }

  /**
   * Relaying is not possible. A demoted primary has a live client and must be able to take over
   * once the port frees up, so it waits as a standby, whatever the reason; a fresh instance
   * settles for the degraded server.
   */
  private blocked(reason: string): Outcome {
    return this.demoted ? { kind: 'standby', reason } : { kind: 'degraded', reason };
  }
}

type Outcome =
  | { kind: 'upstream'; upstream: Upstream; note?: string }
  | { kind: 'standby'; reason: string }
  | { kind: 'degraded'; reason: string };
