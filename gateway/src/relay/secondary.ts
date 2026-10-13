import type { Readable, Writable } from 'node:stream';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { safeText, type UserSelector } from '../routing/index.js';
import {
  RELAY_BACKOFF_CAP_MS,
  RELAY_BACKOFF_START_MS,
  RELAY_CONNECT_ATTEMPTS,
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
  /** The client stopped reading stdout past the cap and its session was dropped. */
  onClientGone?: () => void;
  /** Test hook. */
  sleep?: (ms: number) => Promise<void>;
}

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
  /** Only a relay may recover; a process that holds the link, or is degraded, never re-runs startup. */
  private role: 'relay' | 'primary' | 'degraded' = 'relay';
  private local: Server | undefined;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: SecondaryOptions) {
    this.proxy = new StdioRelayProxy(opts.input, opts.output, opts.log);
    this.proxy.onLost = () => void this.recover();
    this.proxy.onClientGone = () => this.opts.onClientGone?.();
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Resolves once the client is attached to something: the relay, or the degraded server. */
  async start(failedWith: string): Promise<void> {
    const outcome = await this.acquire(false, failedWith);
    if (this.stopped) return;
    this.proxy.start();
    if (outcome.kind === 'upstream') this.proxy.attach(outcome.upstream);
    else await this.serveDegraded(outcome.reason);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.proxy.stop();
    await this.local?.close();
    this.local = undefined;
  }

  private async recover(): Promise<void> {
    if (this.stopped) return;
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
    if (outcome.kind === 'upstream') this.proxy.attach(outcome.upstream);
    else await this.serveDegraded(outcome.reason);
  }

  private async serveDegraded(reason: string): Promise<void> {
    this.role = 'degraded';
    this.opts.log(`relay unavailable, serving gateway_status only: ${reason}`);
    const server = this.opts.createDegraded(reason);
    this.local = server;
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const up = new LocalUpstream(b);
    await up.start();
    this.proxy.attach(up);
  }

  private async acquire(
    tryPrimary: boolean,
    failedWith: string,
  ): Promise<{ kind: 'upstream'; upstream: Upstream } | { kind: 'degraded'; reason: string }> {
    let last = failedWith;
    // Set once a primary agrees to step down for us: from then on we also try to take its place.
    let takeOver = tryPrimary;
    let delay = RELAY_BACKOFF_START_MS;
    for (let attempt = 1; attempt <= RELAY_CONNECT_ATTEMPTS && !this.stopped; attempt++) {
      if (takeOver) {
        const [a, b] = InMemoryTransport.createLinkedPair();
        try {
          if (await this.opts.becomePrimary(a)) {
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
      if (r.kind === 'ok') return { kind: 'upstream', upstream: r.upstream };
      if (r.kind === 'refused') {
        if (r.code === 'RELAY_SELECTOR_MISMATCH')
          return {
            kind: 'degraded',
            reason: `the primary gateway refused this instance: selector mismatch (this instance: ${describe(this.opts.selector)}; primary: ${describe(r.selector)})`,
          };
        if (r.code === 'RELAY_CONFIG_MISMATCH')
          return {
            kind: 'degraded',
            reason: `the primary gateway runs a different configuration (${describeConfigDiff(this.opts.config, r.config)}); it is not older than this instance, so it is left running; quit it or restart Claude Desktop so every instance uses the same settings`,
          };
        if (r.code === 'RELAY_CONFIG_STEPDOWN') {
          this.opts.log('the primary gateway has an older configuration and is stepping down');
          takeOver = true;
          last = 'waiting for the older gateway to step down';
        } else if (r.code !== 'RELAY_AUTH' && r.code !== 'RELAY_FULL')
          return {
            kind: 'degraded',
            reason: `the primary gateway refused the relay: ${safeText(String(r.code))}`,
          };
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
    return {
      kind: 'degraded',
      reason: `could not relay to the gateway holding link port ${this.opts.linkPort} after ${RELAY_CONNECT_ATTEMPTS} attempts: ${last}`,
    };
  }
}
