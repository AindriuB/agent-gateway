/** Link frames seen from the browser side, counted from Playwright WebSocket events. */

export type FrameKind = 'call' | 'welcome' | 'reject' | 'ping' | 'other';

/** Classify a received link frame. Foundry's own socket.io frames and bad JSON are `other`. */
export function frameKind(payload: string | Uint8Array | Buffer): FrameKind {
  const text = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
  if (!text.startsWith('{')) return 'other';
  try {
    const type = (JSON.parse(text) as { type?: unknown }).type;
    return type === 'call' || type === 'welcome' || type === 'reject' || type === 'ping'
      ? type
      : 'other';
  } catch {
    return 'other';
  }
}

/** The error code of a `reject` frame, or undefined for any other frame. */
export function rejectCode(payload: string | Uint8Array | Buffer): string | undefined {
  if (frameKind(payload) !== 'reject') return undefined;
  const text = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
  const code = (JSON.parse(text) as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Does this WebSocket URL point at the gateway link port? */
export function isLinkUrl(url: string, linkPort: number): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && u.port === String(linkPort);
  } catch {
    return false;
  }
}

/** The slice of a Playwright WebSocket the counter uses. */
export interface WsLike {
  url(): string;
  on(event: 'framereceived', cb: (e: { payload: string | Buffer }) => void): unknown;
  on(event: 'close', cb: () => void): unknown;
}

/** The slice of a Playwright Page the counter uses. */
export interface PageLike {
  on(event: 'websocket', cb: (ws: WsLike) => void): unknown;
}

export interface FrameCounts {
  opens: number;
  calls: number;
  welcomes: number;
  closes: number;
}

/** Counts frames on the link WebSocket(s) of one page. Attach before the page navigates. */
export class FrameCounter {
  private counts: FrameCounts = { opens: 0, calls: 0, welcomes: 0, closes: 0 };
  readonly rejectCodes: string[] = [];

  constructor(private readonly linkPort: number) {}

  attach(page: PageLike): this {
    page.on('websocket', (ws) => {
      if (!isLinkUrl(ws.url(), this.linkPort)) return;
      this.counts.opens++;
      ws.on('framereceived', (e) => {
        const kind = frameKind(e.payload);
        if (kind === 'call') this.counts.calls++;
        else if (kind === 'welcome') this.counts.welcomes++;
        else if (kind === 'reject') {
          const code = rejectCode(e.payload);
          if (code) this.rejectCodes.push(code);
        }
      });
      ws.on('close', () => {
        this.counts.closes++;
      });
    });
    return this;
  }

  get snapshot(): FrameCounts {
    return { ...this.counts };
  }

  /** Link WebSockets opened. Playwright does not always fire `close` on a reload; opens always count. */
  get opens(): number {
    return this.counts.opens;
  }

  get calls(): number {
    return this.counts.calls;
  }

  get welcomes(): number {
    return this.counts.welcomes;
  }

  get closes(): number {
    return this.counts.closes;
  }
}

/** Poll `ready` until it is true or `timeoutMs` passes; returns the elapsed ms, or undefined on timeout. */
export async function waitFor(
  ready: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 250,
): Promise<number | undefined> {
  const start = Date.now();
  for (;;) {
    if (await ready()) return Date.now() - start;
    if (Date.now() - start >= timeoutMs) return undefined;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
