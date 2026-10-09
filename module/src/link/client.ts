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
  | { kind: 'disconnected'; reason?: ErrorCode | 'ERROR' }
  | { kind: 'connecting' }
  | { kind: 'connected'; user: string; world: string };

export interface SocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
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

export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;

/** Exponential backoff 1s..60s with up to 20% upward jitter, capped at the maximum. */
export function backoffDelay(attempt: number, random: number): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.min(BACKOFF_MAX_MS, Math.round(base * (1 + 0.2 * random)));
}

export class LinkClient {
  private socket: SocketLike | null = null;
  private timer: unknown = null;
  private attempt = 0;
  private active = false;
  private code: string | null = null;
  private listeners = new Set<(s: LinkState) => void>();
  private _state: LinkState = { kind: 'disconnected' };
  /** Injectable; with none installed every call is answered TOOL_NOT_FOUND. */
  onCall: CallHandler | null = null;

  constructor(private readonly deps: LinkClientDeps) {}

  get state(): LinkState {
    return this._state;
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
    this.begin();
  }

  stop(): void {
    this.active = false;
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
    this.setState({ kind: 'connecting' });
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
      void this.handle(ev.data);
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.socket !== ws) return;
      this.socket = null;
      if (this.active) this.scheduleRetry('ERROR');
    };
  }

  private async handle(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return;
    const parsed = parseLinkMessage(raw);
    if (!parsed.ok) return;
    const msg = parsed.message;
    switch (msg.type) {
      case 'welcome': {
        if (msg.pairingToken) await this.deps.setToken(msg.pairingToken);
        this.code = null;
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
          this.code = null;
          await this.deps.setToken('');
        } else if (msg.code === 'PROTOCOL_MAJOR_MISMATCH') {
          this.deps.notifyError(msg.message);
        }
        this.setState({ kind: 'disconnected', reason: msg.code });
        break;
      case 'ping':
        this.send({ type: 'pong' });
        break;
      case 'call':
        await this.dispatch(msg);
        break;
      default:
        break;
    }
  }

  private async dispatch(call: CallMessage): Promise<void> {
    if (!this.onCall) {
      this.send({
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
        this.send({
          type: 'result',
          id: call.id,
          ok: true,
          text: res.text,
          ...(res.structured !== undefined ? { structured: res.structured } : {}),
        });
      } else {
        this.send({ type: 'error', id: call.id, code: res.code, message: res.message });
      }
    } catch (e) {
      this.send({
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
