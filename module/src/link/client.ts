import {
  PROTOCOL_VERSION,
  parseLinkMessage,
  type ErrorCode,
  type LinkMessage,
} from '@agent-gateway/protocol/link';

export type HelloMessage = Extract<LinkMessage, { type: 'hello' }>;
export type CallMessage = Extract<LinkMessage, { type: 'call' }>;

export type CallResult =
  | { ok: true; text: string; structured?: unknown }
  | { ok: false; code: ErrorCode; message: string };
export type CallHandler = (call: CallMessage) => Promise<CallResult> | CallResult;

export type LinkState =
  | { kind: 'disconnected'; reason?: ErrorCode | 'ERROR' | 'REPLACED' | 'PAIRING_REQUIRED' }
  | { kind: 'connecting'; codeRejected?: boolean }
  | { kind: 'connected'; user: string; world: string };

/** A pairing token bound to the gateway endpoint that issued it. */
export interface TokenCredential {
  url: string;
  token: string;
}

/** Canonical form of a gateway URL; two URLs name the same endpoint iff these are equal. */
export function normalizeGatewayUrl(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  readyState?: number;
  send(data: string): void;
  close(): void;
}

export interface LinkClientDeps {
  getGatewayUrl(): string;
  /**
   * The stored credential as persisted (a JSON string). Only `{ url, token }` is honoured; anything else
   * counts as no token.
   */
  getToken(): unknown;
  /** Persist the token with the gateway URL that issued it, or clear it with `null`. */
  setToken(credential: TokenCredential | null): Promise<unknown> | void;
  /** Everything in `hello` except `type`, `protocolVersion` and `auth`. */
  getIdentity(): Omit<HelloMessage, 'type' | 'protocolVersion' | 'auth'>;
  createSocket(url: string): SocketLike;
  notifyError(message: string): void;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Close code and reason the gateway uses when a newer connection for the same
 * user replaces this one: `ws.close(1000, 'replaced')` in gateway/src/link/server.ts.
 */
export const REPLACED_CLOSE_CODE = 1000;
export const REPLACED_CLOSE_REASON = 'replaced';

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Exponential backoff capped at 60s first, then up to 20% downward jitter (never below 1s). */
export function backoffDelay(attempt: number, random: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.max(BACKOFF_MIN_MS, Math.round(base * (1 - 0.2 * random)));
}

export class LinkClient {
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private attempt = 0;
  private active = false;
  private code: string | null = null;
  /** Normalized gateway URL the code was entered for; a code is never sent anywhere else. */
  private codeUrl: string | null = null;
  /** What was live when stop() ran, for resume(). */
  private resumeMode: 'code' | 'token' | null = null;
  private codeRejected = false;
  private listeners = new Set<(s: LinkState) => void>();
  private _state: LinkState = { kind: 'disconnected' };
  /** Injectable; with none installed every call is answered TOOL_NOT_FOUND. */
  onCall: CallHandler | null = null;

  constructor(private readonly deps: LinkClientDeps) {}

  get state(): LinkState {
    return this._state;
  }

  /** True while the link is trying to stay connected (false once stopped or replaced). */
  get isActive(): boolean {
    return this.active;
  }

  onState(fn: (s: LinkState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * The stored token, only if it was issued by the given gateway URL. A malformed
   * stored value counts as no token.
   */
  private tokenForUrl(url: string): string | null {
    const cred = this.readCredential();
    if (!cred) return null;
    return normalizeGatewayUrl(cred.url) === normalizeGatewayUrl(url) ? cred.token : null;
  }

  private readCredential(): TokenCredential | null {
    let raw = this.deps.getToken();
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (raw && typeof raw === 'object') {
      const { url, token } = raw as Partial<TokenCredential>;
      if (typeof url === 'string' && url && typeof token === 'string' && token) {
        return { url, token };
      }
    }
    return null;
  }

  /** True if a token is stored (for any gateway). */
  hasStoredToken(): boolean {
    return this.readCredential() !== null;
  }

  /**
   * Connect with the stored token, but only to the gateway that issued it. No stored token:
   * no-op. Token issued elsewhere: nothing is sent and a pairing code is requested.
   */
  start(): void {
    if (!this.hasStoredToken()) return;
    if (this.tokenForUrl(this.deps.getGatewayUrl()) === null) {
      this.requirePairing();
      return;
    }
    this.clearCode();
    this.begin();
  }

  private clearCode(): void {
    this.code = null;
    this.codeUrl = null;
  }

  private requirePairing(): void {
    this.resumeMode = null;
    this.active = false;
    this.codeRejected = false;
    this.clearCode();
    this.cancelTimer();
    this.detach();
    this.setState({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' });
  }

  /** Pair with a code printed by the gateway. */
  pair(code: string): void {
    this.code = code;
    this.codeUrl = normalizeGatewayUrl(this.deps.getGatewayUrl());
    this.codeRejected = false;
    this.begin();
  }

  /**
   * Restart whatever was live when stop() ran. A code pairing resumes with the same code, but only
   * against the URL it was entered for; otherwise pairing is required and nothing is sent.
   */
  resume(): void {
    const mode = this.resumeMode;
    if (mode === 'token') {
      this.start();
    } else if (mode === 'code') {
      if (this.code !== null && this.codeUrl === normalizeGatewayUrl(this.deps.getGatewayUrl())) {
        this.codeRejected = false;
        this.begin();
      } else {
        this.requirePairing();
      }
    }
  }

  stop(): void {
    if (this.active) this.resumeMode = this.code !== null ? 'code' : 'token';
    this.active = false;
    this.codeRejected = false;
    this.cancelTimer();
    this.detach();
    this.setState({ kind: 'disconnected' });
  }

  private begin(): void {
    this.resumeMode = null;
    this.cancelTimer();
    this.detach();
    this.active = true;
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    const url = this.deps.getGatewayUrl();
    if (this.code !== null && this.codeUrl !== normalizeGatewayUrl(url)) {
      // Gateway URL changed since the code was entered (e.g. during backoff): never send it there.
      this.requirePairing();
      return;
    }
    if (this.code === null && this.tokenForUrl(url) === null) {
      // Gateway URL changed since the token was issued (e.g. during backoff).
      this.requirePairing();
      return;
    }
    this.setState(
      this.codeRejected ? { kind: 'connecting', codeRejected: true } : { kind: 'connecting' },
    );
    let ws: SocketLike;
    try {
      ws = this.deps.createSocket(url);
    } catch {
      this.scheduleRetry('ERROR');
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      let auth: HelloMessage['auth'];
      if (this.code !== null) {
        auth = { kind: 'pairingCode', code: this.code };
      } else {
        const token = this.tokenForUrl(url);
        if (token === null) {
          this.requirePairing();
          return;
        }
        auth = { kind: 'pairingToken', token };
      }
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ...this.deps.getIdentity(),
        auth,
      });
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      void this.handle(ws, ev.data, url);
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (this.socket !== ws) return;
      this.socket = null;
      const close = ev as { code?: number; reason?: string } | undefined;
      if (close?.code === REPLACED_CLOSE_CODE && close.reason === REPLACED_CLOSE_REASON) {
        // Another tab took over the link; retrying would just evict it in turn.
        this.active = false;
        this.cancelTimer();
        this.resumeMode = null;
        this.setState({ kind: 'disconnected', reason: 'REPLACED' });
        return;
      }
      if (this.active) this.scheduleRetry('ERROR');
    };
  }

  private async handle(origin: SocketLike, raw: unknown, url: string): Promise<void> {
    if (typeof raw !== 'string') return;
    const parsed = parseLinkMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.message;
    switch (msg.type) {
      case 'welcome': {
        if (msg.pairingToken) {
          await this.deps.setToken({ url, token: msg.pairingToken });
          if (this.socket !== origin) {
            // stop() or a restart ran during the write. The token is legitimately issued and now stored,
            // but this socket is gone: do not report connected.
            if (
              !this.active &&
              this.resumeMode === 'code' &&
              this.codeUrl === normalizeGatewayUrl(url)
            ) {
              this.clearCode();
              this.resumeMode = 'token';
            }
            return;
          }
        }
        this.clearCode();
        this.codeRejected = false;
        this.attempt = 0;
        const id = this.deps.getIdentity();
        this.setState({ kind: 'connected', user: id.user.name, world: id.world.title });
        break;
      }
      case 'reject':
        this.active = false;
        this.resumeMode = null;
        this.cancelTimer();
        this.detach();
        if (msg.code === 'PAIRING_INVALID') {
          // Only a rejected token is stale; a rejected code leaves a working token alone.
          const usedToken = this.code === null;
          this.clearCode();
          if (usedToken) {
            await this.deps.setToken(null);
          } else if (this.tokenForUrl(this.deps.getGatewayUrl()) !== null) {
            // Rejected code: fall back to the token, which is only held for this same gateway.
            this.codeRejected = true;
            this.start();
            break;
          }
        } else if (msg.code === 'PROTOCOL_MAJOR_MISMATCH') {
          this.deps.notifyError(msg.message);
        }
        this.setState({ kind: 'disconnected', reason: msg.code });
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'call':
        await this.dispatch(origin, msg);
        break;
      default:
        break;
    }
  }

  private async dispatch(origin: SocketLike, call: CallMessage): Promise<void> {
    // Replies go only to the socket that received the call, and only while it is still current.
    const reply = (msg: LinkMessage): void => {
      if (this.socket !== origin) return;
      if (origin.readyState !== undefined && origin.readyState !== 1) return;
      origin.send(JSON.stringify(msg));
    };
    if (!this.onCall) {
      reply({
        type: 'error',
        id: call.id,
        code: 'TOOL_NOT_FOUND',
        message: `No handler installed for tool ${call.tool}`,
      });
      return;
    }
    try {
      const res = await this.onCall(call);
      if (res.ok) {
        reply({
          type: 'result',
          id: call.id,
          ok: true,
          text: res.text,
          ...(res.structured !== undefined ? { structured: res.structured } : {}),
        });
      } else {
        reply({ type: 'error', id: call.id, code: res.code, message: res.message });
      }
    } catch (e) {
      reply({
        type: 'error',
        id: call.id,
        code: 'INTERNAL',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private scheduleRetry(reason: 'ERROR'): void {
    this.detach();
    this.setState({ kind: 'disconnected', reason });
    const delay = backoffDelay(this.attempt, (this.deps.random ?? Math.random)());
    this.attempt += 1;
    const set = this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.timer = set(() => {
      this.timer = null;
      if (this.active) this.connect();
    }, delay);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }

  private detach(): void {
    const ws = this.socket;
    this.socket = null;
    if (!ws) return;
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  private send(msg: LinkMessage): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private setState(s: LinkState): void {
    this._state = s;
    for (const fn of this.listeners) fn(s);
  }
}
