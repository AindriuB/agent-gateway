import { OfflineQueue } from './offline-queue/service.js';
import { EventBuffer } from './events/index.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Readable, Writable } from 'node:stream';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Config } from './config/index.js';
import { LinkListenError } from './link/server.js';
import {
  LinkRegistry,
  LinkServer,
  PairingCodes,
  type LiveCode,
  type PairingCodesOptions,
} from './link/index.js';
import { createLogger, type Logger } from './log.js';
import {
  HTTP_BIND_HOST,
  HTTP_SESSION_IDLE_MS,
  MAX_HTTP_SESSIONS,
  MAX_REQUEST_BYTES,
  SELF_PROTECT_RPS,
} from './config/index.js';
import { HttpServer, loadOrCreateToken } from './http/index.js';
import { OAuthServer, type ConsentStep } from './oauth/index.js';
import { createDegradedServer } from './mcp/degraded.js';
import { createSessionServer } from './mcp/session.js';
import type { UserSelector } from './routing/index.js';
import { openStore, type Store } from './store/index.js';
import {
  LocalUpstream,
  makeRelayConfig,
  createStandbyServer,
  RelaySecondary,
  RelayServer,
  relayEndpoint,
  StdioRelayProxy,
} from './relay/index.js';

/** True for failures caused by another running gateway owning the link port or the db. */
function isInstanceConflict(err: unknown): boolean {
  if (err instanceof LinkListenError) return err.code === 'EADDRINUSE';
  const e = err as { errcode?: number; message?: string } | null;
  return e?.errcode === 5 || /database is locked/i.test(e?.message ?? '');
}

/** Backoff for retrying HTTP after a takeover could not bind it. */
const HTTP_RETRY_MIN_MS = 5_000;
const HTTP_RETRY_MAX_MS = 60_000;
const MAX_WARNED_ORIGINS = 20;
const MAX_ORIGIN_CHARS = 100;

/** Refusals of a stored token: the browser should be offered a code to pair again. */
const TOKEN_REFUSALS: ReadonlySet<string> = new Set([
  'pairing token is unknown, revoked, or for another world or user',
  'pairing predates origin binding; pair again with a code',
  'pairing was made from a different origin',
]);

const minutesLeft = (expiresAt: number, now: number): number =>
  Math.max(1, Math.ceil((expiresAt - now) / 60_000));

/** Make an untrusted Origin header safe for a log line: printable ASCII only, bounded. */
export function sanitizeOrigin(origin: string | undefined): string {
  if (origin === undefined) return '(absent)';
  const clean = origin.replace(/[^\x21-\x7e]/g, '?');
  return clean.length > MAX_ORIGIN_CHARS ? `${clean.slice(0, MAX_ORIGIN_CHARS)}...` : clean;
}

export function defaultDbPath(): string {
  return join(homedir(), '.foundry-agent-gateway', 'gateway.db');
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AppDeps {
  version: string;
  logger?: Logger;
  /** Which connected Foundry user the MCP session binds to; omitted means "the only one". */
  selector?: UserSelector;
  /** Optional extra restriction: only these exact `Origin` values may reach the link. */
  allowedOrigins?: readonly string[];
  dbPath?: string;
  /** Where the pairing code line goes; defaults to stderr (stdout carries MCP). */
  writeStatus?: (line: string) => void;
  /** MCP stdio streams; default to the process's. Injectable for tests. */
  stdin?: Readable;
  stdout?: Writable;
  /** Store opener; injectable so tests can prove a relay never opens the db. */
  openStore?: typeof openStore;
  /**
   * A newer instance with different settings asked this primary to step down. By default the
   * instance stays alive in-process: it releases the link, HTTP and the store, and keeps its stdio
   * session as a relay secondary (or a standby) that takes over when the newer primary goes away.
   */
  onStepDown?: (why: string) => void;
  /** Clock and timers for pairing-code expiry; injectable so tests need not wait ten minutes. */
  codeClock?: Pick<PairingCodesOptions, 'now' | 'setTimer' | 'clearTimer'>;
  /** Serve MCP over local Streamable HTTP (primary only). */
  http?: boolean;
  /** Timers for the takeover HTTP retry; injectable so tests need not wait. */
  httpRetryTimers?: {
    setTimer: (fn: () => void, ms: number) => unknown;
    clearTimer: (handle: unknown) => void;
  };
  /** The OAuth consent step (public mode). Defaults to auto-deny until the consent page (67). */
  oauthConsent?: ConsentStep;
  /** Overrides for the HTTP limits; tests shorten them. */
  httpLimits?: Partial<{
    maxRequestBytes: number;
    rps: number;
    maxSessions: number;
    idleMs: number;
  }>;
}

export function createApp(config: Config, deps: AppDeps): App {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const writeStatus = deps.writeStatus ?? ((l: string) => void process.stderr.write(`${l}\n`));
  let server: Server | undefined;
  let link: LinkServer | undefined;
  let store: Store | undefined;
  let events: EventBuffer | undefined;
  let queue: OfflineQueue | undefined;
  let relay: RelayServer | undefined;
  let httpServer: HttpServer | undefined;
  let httpRetryTimer: unknown;
  // Bumped synchronously by stop() and teardown(): work begun under an older value is stale.
  let httpGen = 0;
  let secondary: RelaySecondary | undefined;
  let stdioProxy: StdioRelayProxy | undefined;
  let codes: PairingCodes | undefined;
  // One step-down transition at a time; a request that arrives during one is ignored.
  let steppingDown = false;
  let httpNoticeShown = false;
  // The relay and its secret/socket files live in the db's directory; an in-memory db has none.
  const dbPath = deps.dbPath ?? defaultDbPath();
  const startedAt = Date.now();
  // Tests build partial configs, so every exposure setting reads as off when missing.
  const publicUrl = config.publicUrl || '';
  const isPublic = publicUrl !== '';
  const serverMode = config.serverMode === true;
  const linkHost = config.linkHost || HTTP_BIND_HOST;
  const httpHost = config.httpHost || HTTP_BIND_HOST;
  const trustProxy = config.trustProxy === true;
  const httpOn = deps.http === true || isPublic || serverMode;
  let exposureNoticesShown = false;
  const relayConfig = () =>
    makeRelayConfig(deps.allowedOrigins ?? [], config.httpPort, config.logLevel, startedAt, {
      publicUrl,
      serverMode,
      linkHost,
      httpHost,
      trustProxy,
    });
  const stateDir = dbPath === ':memory:' ? undefined : dirname(dbPath);
  // What this instance found in its way, for the one log line written once its role is final.
  let holds = `another gateway holds link port ${config.linkPort}`;
  const app: App = {
    async start() {
      try {
        // A server-mode gateway has no stdio client and nothing to degrade to: a conflict is fatal.
        if (serverMode) {
          await startPrimary(undefined);
          return;
        }
        // The client's stdio goes through the same proxy as a relay's, so every instance gets the
        // same stdout back-pressure, cap and oversized-line handling. It only starts reading
        // stdin once this instance really is the primary.
        const [sessionSide, stdioSide] = InMemoryTransport.createLinkedPair();
        try {
          await startPrimary(sessionSide);
        } catch (err) {
          void stdioSide.close();
          throw err;
        }
        await attachStdio(stdioSide);
      } catch (err) {
        await this.stop();
        if (serverMode) throw err;
        // Only a conflict with another running gateway degrades. A real failure of the
        // only instance (corrupt db, permissions) must still exit 1 via reportStartFailure.
        if (!isInstanceConflict(err)) throw err;
        const reason = (err as Error).message;
        // No log line yet: the role is not known until the relay or takeover attempts settle.
        holds =
          err instanceof LinkListenError
            ? `another gateway holds link port ${err.port}`
            : 'another gateway holds the pairing database';
        await startSecondary(reason);
      }
    },
    async stop() {
      httpGen++;
      cancelHttpRetry();
      stdioProxy?.stop();
      stdioProxy = undefined;
      codes?.stop();
      codes = undefined;
      await httpServer?.close();
      httpServer = undefined;
      await secondary?.stop();
      secondary = undefined;
      await relay?.close();
      relay = undefined;
      await server?.close();
      server = undefined;
      queue?.close();
      queue = undefined;
      events?.close();
      events = undefined;
      await link?.close();
      link = undefined;
      store?.close();
      store = undefined;
    },
  };
  return app;

  function openedStore(): Store {
    if (!store) throw new Error('store is not open yet');
    return store;
  }

  /** Serve the in-process session to the client on stdio, through the bounded proxy. */
  async function attachStdio(stdioSide: InMemoryTransport, exitWhenGone = false): Promise<void> {
    const proxy = new StdioRelayProxy(
      deps.stdin ?? process.stdin,
      deps.stdout ?? process.stdout,
      writeStatus,
    );
    // A client that stops reading is dropped; a primary keeps serving other instances' sessions.
    proxy.onClientGone = () => {
      if (exitWhenGone) void app.stop().finally(() => process.exit(0));
    };
    const up = new LocalUpstream(stdioSide);
    await up.start();
    stdioProxy = proxy;
    proxy.attach(up);
    proxy.start();
  }

  async function startRelay(linkPort: number, createSession: () => Server): Promise<void> {
    const ep = stateDir ? relayEndpoint(stateDir, linkPort) : undefined;
    if (!stateDir || !ep) return;
    if (!ep.ok) {
      writeStatus(
        `relay off: ${ep.reason}; other gateway instances will only answer gateway_status`,
      );
      return;
    }
    const candidate = new RelayServer({
      endpoint: ep.path,
      stateDir,
      linkPort,
      selector: deps.selector ?? {},
      createSession,
      log: writeStatus,
      config: relayConfig(),
      onStepDown: (why) => {
        writeStatus(`stepping down: a newer gateway instance has different settings (${why})`);
        if (deps.onStepDown) deps.onStepDown(why);
        else void stepDownInProcess(why);
      },
    });
    try {
      await candidate.listen();
      relay = candidate;
    } catch (err) {
      writeStatus(
        `relay off: ${(err as Error).message}; other gateway instances will only answer gateway_status`,
      );
    }
  }

  function cancelHttpRetry(): void {
    if (httpRetryTimer !== undefined)
      (deps.httpRetryTimers?.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout)))(
        httpRetryTimer,
      );
    httpRetryTimer = undefined;
  }

  /** At most one timer is ever armed; each failed attempt re-arms it with a longer, capped delay. */
  function scheduleHttpRetry(
    gen: number,
    attempt: () => Promise<void>,
    delay: number,
    lastReason: string,
  ): void {
    cancelHttpRetry();
    const set = deps.httpRetryTimers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms).unref());
    httpRetryTimer = set(() => {
      httpRetryTimer = undefined;
      if (gen !== httpGen) return;
      attempt().catch((err: unknown) => {
        // Never re-arm for an app that was stopped while the attempt was in flight.
        if (gen !== httpGen) return;
        const reason = httpFailure(err);
        if (reason !== lastReason) writeStatus(`HTTP still off: ${reason}; retrying`);
        scheduleHttpRetry(gen, attempt, Math.min(delay * 2, HTTP_RETRY_MAX_MS), reason);
      });
    }, delay);
  }

  function httpFailure(err: unknown): string {
    return (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
      ? `${httpHost}:${config.httpPort} in use`
      : (err as Error).message;
  }

  /** Undo a failed or finished startPrimary. */
  async function teardown(): Promise<void> {
    httpGen++;
    cancelHttpRetry();
    codes?.stop();
    codes = undefined;
    await httpServer?.close();
    httpServer = undefined;
    await relay?.close();
    relay = undefined;
    await server?.close();
    server = undefined;
    queue?.close();
    queue = undefined;
    events?.close();
    events = undefined;
    await link?.close();
    link = undefined;
    store?.close();
    store = undefined;
  }

  /** The one log line for a non-primary instance, written once its role is final. */
  function logSettled(role: 'relay' | 'standby' | 'degraded', why: string): void {
    const text = (what: string) => `pid ${process.pid}: ${holds}; this instance ${what} (${why})`;
    if (role === 'relay') logger.info(text('relays to it and cannot pair'));
    else if (role === 'standby') logger.warn(text('is a standby and cannot pair'));
    else logger.warn(text('is degraded and cannot pair'));
    if (httpOn && !httpNoticeShown) {
      httpNoticeShown = true;
      writeStatus(
        'HTTP is served only by the primary gateway instance; if that was started without --http, restart it with --http',
      );
    }
  }

  function makeSecondary(endpoint: string, proxy?: StdioRelayProxy): RelaySecondary {
    return new RelaySecondary({
      endpoint,
      stateDir: stateDir!,
      linkPort: config.linkPort,
      selector: deps.selector ?? {},
      config: relayConfig(),
      input: deps.stdin ?? process.stdin,
      output: deps.stdout ?? process.stdout,
      log: writeStatus,
      ...(proxy ? { proxy } : {}),
      async becomePrimary(transport) {
        // Outside the try: teardown must never run against a live primary.
        if (link) throw new Error('this process already holds the link');
        try {
          await startPrimary(transport, true);
          return true;
        } catch (err) {
          await teardown();
          if (isInstanceConflict(err)) return false;
          throw err;
        }
      },
      onClientGone: () => {
        // A relay with no client has no purpose; a primary still serves other instances' sessions.
        if (!link) void app.stop().finally(() => process.exit(0));
      },
      onSettled: logSettled,
      createDegraded: (why) => createDegradedServer({ version: deps.version, reason: why }),
      createStandby: (why) => createStandbyServer({ version: deps.version, reason: why }),
    });
  }

  /**
   * A newer instance with different settings asked this primary to step down, and the grace
   * period is over. Release the link, HTTP, queue, events and store, but keep the client's stdio
   * session: it moves to the new primary through the relay, or to a standby.
   */
  async function stepDownInProcess(why: string): Promise<void> {
    if (steppingDown) return;
    const ep = stateDir ? relayEndpoint(stateDir, config.linkPort) : undefined;
    const proxy = secondary ? undefined : stdioProxy;
    if (!ep?.ok || (!secondary && !proxy)) {
      // Nothing to hand the client's session to: the previous behaviour.
      void app.stop().finally(() => process.exit(0));
      return;
    }
    steppingDown = true;
    // Whatever stopped this instance at startup no longer applies: it now yields to a newer one.
    holds = `another gateway holds link port ${config.linkPort}`;
    try {
      secondary ??= makeSecondary(ep.path, proxy);
      await secondary.demote(`a newer gateway took over (${why})`, teardown);
    } catch (err) {
      writeStatus(`step-down failed: ${(err as Error).message}`);
      void app.stop().finally(() => process.exit(1));
    } finally {
      steppingDown = false;
    }
  }

  async function startSecondary(reason: string): Promise<void> {
    const ep = stateDir ? relayEndpoint(stateDir, config.linkPort) : undefined;
    if (!stateDir || !ep?.ok) {
      const why = ep && !ep.ok ? ep.reason : 'this instance has no state directory';
      server = createDegradedServer({
        version: deps.version,
        reason: `${reason} (relaying is off: ${why})`,
      });
      const [sessionSide, stdioSide] = InMemoryTransport.createLinkedPair();
      await server.connect(sessionSide);
      await attachStdio(stdioSide, true);
      logSettled('degraded', `relaying is off: ${why}`);
      return;
    }
    secondary = makeSecondary(ep.path);
    await secondary.start(reason);
  }

  async function startPrimary(transport: Transport | undefined, retryHttp = false): Promise<void> {
    // Never start over a live primary: it would replace `link` and orphan the original.
    if (link) throw new Error('this process already holds the link');
    // Hold the link port before touching the shared db: opening it runs migrations and
    // retention deletes, which a secondary instance must never do. A loser fails here with
    // EADDRINUSE. The store is opened in the same tick as listen resolves, before any
    // connection can be handled, so the lazy getters below are never read while unset.
    const registry = new LinkRegistry();
    let linkPort = config.linkPort;
    const now = deps.codeClock?.now ?? Date.now;
    // Sessions that finished their handshake; each leaves the set when it closes, and the relay
    // caps how many there can be.
    const initialized = new Set<Server>();
    const linesFor = (c: LiveCode): [string, string] => [
      `Pairing code: ${c.code} (expires in ${minutesLeft(c.expiresAt, now())} min)`,
      `Link URL: ws://localhost:${linkPort} (pid ${process.pid} holds link port ${linkPort})`,
    ];
    // Hosts such as Claude Desktop hide stderr, so also offer the code as an MCP log message.
    // Only to sessions past their handshake: a notification before `initialize` is out of order.
    // A public gateway never shows a code to an MCP client: it goes to the operator's log only.
    const sendNotice = (s: Server, c: LiveCode): void =>
      isPublic
        ? undefined
        : void s
            .sendLoggingMessage({
              level: 'notice',
              logger: 'pairing',
              data: linesFor(c).join('. '),
            })
            .catch(() => undefined);
    const thisCodes = new PairingCodes({
      ...deps.codeClock,
      onIssued: (c) => {
        // Each code gets one refusal line per origin: a repeat refusal after a refresh must show
        // the new code. Clearing (not growing) keeps the set bounded.
        warned.clear();
        for (const line of linesFor(c)) writeStatus(line);
        for (const s of initialized) sendNotice(s, c);
      },
    });
    codes = thisCodes;
    const track = (s: Server): Server => {
      s.oninitialized = () => {
        initialized.add(s);
        const c = thisCodes.current();
        if (c) sendNotice(s, c);
      };
      const previous = s.onclose;
      s.onclose = () => {
        initialized.delete(s);
        previous?.();
      };
      return s;
    };
    const warned = new Set<string>();
    link = new LinkServer({
      port: config.linkPort,
      host: linkHost,
      allowNonLoopback: linkHost !== HTTP_BIND_HOST,
      ...(isPublic ? { publicUrl, trustProxy } : {}),
      // With nothing asking for a code, a spent one would never be replaced.
      onCodePaired: () => {
        if (isPublic) thisCodes.issue('consumed');
      },
      onOriginRejected: (origin, reason, detail) => {
        const shown = sanitizeOrigin(origin);
        if (TOKEN_REFUSALS.has(reason)) thisCodes.issue('refused-token');
        const key = `${shown} ${reason} ${detail ?? ''}`;
        if (warned.has(key) || warned.size >= MAX_WARNED_ORIGINS) return;
        warned.add(key);
        const live = thisCodes.current();
        const where =
          reason === 'no valid pairing code'
            ? isPublic
              ? ' The code is in this log.'
              : " The code is in this log or the client's MCP log."
            : live && TOKEN_REFUSALS.has(reason)
              ? ` Enter pairing code ${live.code} (expires in ${minutesLeft(live.expiresAt, now())} min) in the Agent Gateway pairing prompt${isPublic ? '.' : "; it is also in the client's MCP log."}`
              : '';
        writeStatus(
          `rejected link connection from origin ${shown}: ${reason}${detail ? ` (${detail})` : ''}.${where}`,
        );
      },
      get store() {
        return openedStore();
      },
      codes: thisCodes,
      registry,
      ...(deps.allowedOrigins?.length ? { allowedOrigins: deps.allowedOrigins } : {}),
      gatewayVersion: deps.version,
      get events() {
        return events;
      },
      get queue() {
        return queue;
      },
    });
    const port = await link.listen();
    linkPort = port;
    if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
    store = (deps.openStore ?? openStore)(dbPath);
    events = new EventBuffer(store, registry);
    queue = new OfflineQueue(store, registry);
    events.startRetention();
    thisCodes.issue('startup');
    const sessionOptions = (e: EventBuffer, q: OfflineQueue) => ({
      version: deps.version,
      registry,
      events: e,
      queue: q,
      ...(deps.selector ? { selector: deps.selector } : {}),
      knownIdentities: () =>
        store?.listActivePairings().map((p) => ({
          worldId: p.worldId,
          userId: p.userId,
          userName: p.userName,
        })) ?? [],
      log: writeStatus,
      ...(isPublic
        ? { askOperator: true }
        : {
            pairingHint: () => {
              const c = thisCodes.issue('mcp');
              return { code: c.code, expiresInMin: minutesLeft(c.expiresAt, now()) };
            },
          }),
    });
    const ready = { events, queue };
    if (transport) {
      server = track(createSessionServer(sessionOptions(ready.events, ready.queue)));
      await server.connect(transport);
    }
    // Relayed sessions are accepted only once everything they share is ready.
    await startRelay(port, () =>
      track(createSessionServer(sessionOptions(ready.events, ready.queue))),
    );
    if (!exposureNoticesShown && (isPublic || serverMode)) {
      exposureNoticesShown = true;
      if (linkHost !== HTTP_BIND_HOST || httpHost !== HTTP_BIND_HOST)
        writeStatus(
          'listening beyond loopback: TLS must be terminated by a reverse proxy in front of the gateway',
        );
      if (publicUrl.startsWith('http:'))
        writeStatus(
          'warning: --public-url uses http: on a loopback host; this is for local testing only, use https: in production',
        );
      if (isPublic && !trustProxy)
        writeStatus(
          '--trust-proxy is off: if a reverse proxy is in front, every client shares one rate-limit bucket',
        );
    }
    const gen = httpGen;
    const startHttp = async (): Promise<void> => {
      // A public gateway has no static bearer: remote clients sign in with OAuth (task 35).
      const token = isPublic ? undefined : loadOrCreateToken(openedStore());
      const oauth = isPublic
        ? new OAuthServer({
            repo: openedStore().oauth,
            publicUrl,
            ...(deps.oauthConsent ? { consent: deps.oauthConsent } : {}),
          })
        : undefined;
      const lim = deps.httpLimits ?? {};
      const candidate = new HttpServer({
        host: httpHost,
        port: config.httpPort,
        ...(token ? { token } : oauth ? { oauth } : { authenticate: () => undefined }),
        ...(isPublic ? { publicUrl, trustProxy } : {}),
        registry,
        version: deps.version,
        startedAt,
        createSession: ({ principal }) => {
          // Fail closed (the HttpServer already answers 403): never fall back to deps.selector or
          // follow mode for a public session.
          if (isPublic && !principal.selector)
            throw new Error('a public session needs a granted (world, user)');
          return track(
            createSessionServer({
              ...sessionOptions(ready.events, ready.queue),
              ...(principal.selector
                ? {
                    selector: {
                      world: principal.selector.worldId,
                      user: principal.selector.userId,
                      exactId: true,
                    },
                  }
                : {}),
              ...(principal.scopes
                ? {
                    allowedCategories: principal.scopes as readonly (
                      | 'read'
                      | 'write'
                      | 'destructive'
                      | 'code'
                    )[],
                  }
                : {}),
            }),
          );
        },
        maxRequestBytes: lim.maxRequestBytes ?? MAX_REQUEST_BYTES,
        rps: lim.rps ?? SELF_PROTECT_RPS,
        maxSessions: lim.maxSessions ?? MAX_HTTP_SESSIONS,
        idleMs: lim.idleMs ?? HTTP_SESSION_IDLE_MS,
      });
      const httpPort = await candidate.listen();
      // The app was stopped while the listen was pending: commit and print nothing.
      if (gen !== httpGen) {
        await candidate.close();
        return;
      }
      // Anything failing after a successful listen must release the port, or every retry
      // would hit EADDRINUSE against our own listener.
      let stored: boolean;
      try {
        stored = token?.commit() ?? true;
      } catch (err) {
        await candidate.close().catch(() => undefined);
        throw err;
      }
      httpServer = candidate;
      if (!token) {
        writeStatus(
          'HTTP bearer token is off because --public-url is set; remote clients sign in with OAuth',
        );
      } else if (token.created && stored) {
        writeStatus(`HTTP bearer token (shown once, stored hashed): ${token.created}`);
      } else if (token.created) {
        writeStatus(
          "HTTP bearer token: a rotated token is already in effect; this instance's own token was discarded",
        );
      }
      writeStatus(
        token
          ? `MCP HTTP at http://${httpHost}:${httpPort}/mcp (Authorization: Bearer <token>)`
          : `MCP HTTP at http://${httpHost}:${httpPort}/mcp (public URL ${publicUrl})`,
      );
    };
    if (httpOn) {
      try {
        await startHttp();
      } catch (err) {
        // First start exits at once so the user sees the conflict. A takeover keeps Foundry
        // working and retries HTTP in the background.
        if (!retryHttp) throw err;
        const why = httpFailure(err);
        writeStatus(`HTTP off: ${why}; retrying`);
        if (gen === httpGen) scheduleHttpRetry(gen, startHttp, HTTP_RETRY_MIN_MS, why);
      }
    }
    logger.info(`MCP stdio server started`);
  }
}
