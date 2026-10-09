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
  | { kind: 'disconnected'; reason?: ErrorCode | 'ERROR' | 'REPLACED' }
  | { kind: 'connecting'; codeRejected?: boolean }
  | { kind: 'connected'; user: string; world: string };

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
  getToken(): string;
  setToken(token: string): Promise<unknown> | void;
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

  /** Connect with the stored token (no-op when none is stored). */
  start(): void {
    if (!this.deps.getToken()) return;
    this.code = null;
    this.begin();
  }

  /** Pair with a code printed by the gateway. */
  pair(code: string): void {
    this.code = code;
    this.codeRejected = false;
    this.begin();
  }

  stop(): void {
    this.active = false;
    this.codeRejected = false;
    this.cancelTimer();
    this.detach();
    this.setState({ kind: 'disconnected' });
  }

  private begin(): void {
    this.cancelTimer();
    this.detach();
    this.active = true;
    this.attempt = 0;
    this.connect();
  }

  private connect(): void {
    this.setState(
      this.codeRejected ? { kind: 'connecting', codeRejected: true } : { kind: 'connecting' },
    );
    let ws: SocketLike;
    try {
      ws = this.deps.createSocket(this.deps.getGatewayUrl());
    } catch {
      this.scheduleRetry('ERROR');
      return;
    }
    this.socket = ws;
    ws.onopen = () => {
      const token = this.deps.getToken();
      const auth: HelloMessage['auth'] =
        this.code !== null
          ? { kind: 'pairingCode', code: this.code }
          : { kind: 'pairingToken', token };
      this.send({
        type: 'hello',
        protocolVersion: PROTOCOL_VERSION,
        ...this.deps.getIdentity(),
        auth,
      });
    };
    ws.onmessage = (ev) => {
      if (this.socket !== ws) return;
      void this.handle(ws, ev.data);
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
        this.setState({ kind: 'disconnected', reason: 'REPLACED' });
        return;
      }
      if (this.active) this.scheduleRetry('ERROR');
    };
  }

  private async handle(origin: SocketLike, raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return;
    const parsed = parseLinkMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.message;
    switch (msg.type) {
      case 'welcome': {
        if (msg.pairingToken) await this.deps.setToken(msg.pairingToken);
        this.code = null;
        this.codeRejected = false;
        this.attempt = 0;
        const id = this.deps.getIdentity();
        this.setState({ kind: 'connected', user: id.user.name, world: id.world.title });
        break;
      }
      case 'reject':
        this.active = false;
        this.cancelTimer();
        this.detach();
        if (msg.code === 'PAIRING_INVALID') {
          // Only a rejected token is stale; a rejected code leaves a working token alone.
          const usedToken = this.code === null;
          this.code = null;
          if (usedToken) {
            await this.deps.setToken('');
          } else if (this.deps.getToken()) {
            // Rejected code: fall back to the working token connection.
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
