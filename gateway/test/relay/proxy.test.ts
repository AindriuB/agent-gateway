import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  LocalUpstream,
  MAX_RELAY_BUFFERED_BYTES,
  MAX_RELAY_LINE_BYTES,
  MAX_RELAY_PENDING,
  StdioRelayProxy,
  type RpcMessage,
  type Upstream,
} from '../../src/relay/index.js';

class FakeUpstream implements Upstream {
  onMessage?: (m: RpcMessage) => void;
  onClose?: () => void;
  sent: RpcMessage[] = [];
  accept = true;
  send(m: RpcMessage): boolean {
    this.sent.push(m);
    return this.accept;
  }
  close(): void {
    this.onClose?.();
  }
}

function rig() {
  const input = new PassThrough();
  const output = new PassThrough();
  const out: RpcMessage[] = [];
  let buf = '';
  output.on('data', (d: Buffer) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      out.push(JSON.parse(buf.slice(0, i)) as RpcMessage);
      buf = buf.slice(i + 1);
    }
  });
  const proxy = new StdioRelayProxy(input, output);
  void input;
  proxy.start();
  const write = (m: object) => input.write(`${JSON.stringify(m)}\n`);
  const tick = () => new Promise((r) => setTimeout(r, 10));
  return { proxy, write, out, tick, input };
}

describe('StdioRelayProxy', () => {
  it('answers RELAY_BUSY past the pending cap and frees ids on reply', async () => {
    const { proxy, write, out, tick } = rig();
    const up = new FakeUpstream();
    proxy.attach(up);
    for (let i = 0; i < MAX_RELAY_PENDING + 1; i++) write({ jsonrpc: '2.0', id: i, method: 'x' });
    await tick();
    expect(up.sent).toHaveLength(MAX_RELAY_PENDING);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: MAX_RELAY_PENDING, error: { code: -32001 } });
    expect(JSON.stringify(out[0])).toContain('RELAY_BUSY');
    up.onMessage?.({ jsonrpc: '2.0', id: 0, result: {} });
    expect(proxy.pendingCount).toBe(MAX_RELAY_PENDING - 1);
  });

  it('fails pending with RELAY_LOST, then RELAY_RECONNECTING, then replays the handshake', async () => {
    const { proxy, write, out, tick } = rig();
    const up = new FakeUpstream();
    let lost = 0;
    proxy.onLost = () => void lost++;
    proxy.attach(up);
    write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { a: 1 } });
    write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    write({ jsonrpc: '2.0', id: 'abc', method: 'tools/call' });
    await tick();
    up.onMessage?.({ jsonrpc: '2.0', id: 0, result: {} });
    up.close();
    expect(lost).toBe(1);
    expect(out.filter((m) => 'error' in m).map((m) => m.id)).toEqual(['abc']);
    expect(JSON.stringify(out.at(-1))).toContain('RELAY_LOST');
    write({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
    await tick();
    expect(JSON.stringify(out.at(-1))).toContain('RELAY_RECONNECTING');

    const next = new FakeUpstream();
    proxy.attach(next);
    expect(next.sent[0]).toMatchObject({
      method: 'initialize',
      params: { a: 1 },
      id: expect.any(String),
    });
    expect(next.sent[1]).toMatchObject({ method: 'notifications/initialized' });
    expect(out.at(-1)).toMatchObject({ method: 'notifications/tools/list_changed' });
    // The replayed initialize reply never reaches the client.
    const before = out.length;
    next.onMessage?.({ jsonrpc: '2.0', id: next.sent[0]!.id, result: {} });
    expect(out).toHaveLength(before);
  });
});

describe('StdioRelayProxy back-pressure and oversized lines', () => {
  it('resumes stdin on an upstream swap even though the old upstream never drained', async () => {
    const { proxy, write, out, tick, input } = rig();
    const old = new FakeUpstream();
    old.accept = false; // its socket buffer is full
    proxy.attach(old);
    write({ jsonrpc: '2.0', id: 1, method: 'big' });
    await tick();
    expect(input.isPaused()).toBe(true);
    old.close(); // destroyed before it ever drained
    expect(input.isPaused()).toBe(false);
    const next = new FakeUpstream();
    proxy.attach(next);
    write({ jsonrpc: '2.0', id: 2, method: 'again' });
    await tick();
    expect(next.sent.map((m) => m.id)).toContain(2);
    expect(out.some((m) => m.id === 1 && JSON.stringify(m).includes('RELAY_LOST'))).toBe(true);
  });

  it('a stale upstream draining does not resume stdin for the current one', async () => {
    const { proxy, write, tick, input } = rig();
    const old = new FakeUpstream();
    proxy.attach(old);
    const cur = new FakeUpstream();
    cur.accept = false;
    proxy.attach(cur);
    write({ jsonrpc: '2.0', id: 1, method: 'x' });
    await tick();
    expect(input.isPaused()).toBe(true);
    old.onDrain?.();
    expect(input.isPaused()).toBe(true);
    cur.onDrain?.();
    expect(input.isPaused()).toBe(false);
  });

  it('rejects an oversized request by id without killing a local upstream', async () => {
    const { proxy, write, out, tick, input } = rig();
    const [a, b] = InMemoryTransport.createLinkedPair();
    const echoed: RpcMessage[] = [];
    a.onmessage = (m) => {
      echoed.push(m as unknown as RpcMessage);
      void a.send({ jsonrpc: '2.0', id: (m as { id: number }).id, result: {} });
    };
    await a.start();
    const up = new LocalUpstream(b);
    await up.start();
    proxy.attach(up);
    input.write(
      `{"jsonrpc":"2.0","id":7,"method":"x","params":"${'a'.repeat(MAX_RELAY_LINE_BYTES + 5)}"}\n`,
    );
    await tick();
    expect(out[0]).toMatchObject({ id: 7, error: { code: -32600 } });
    expect(echoed).toHaveLength(0);
    write({ jsonrpc: '2.0', id: 8, method: 'ok' });
    await tick();
    expect(out.at(-1)).toMatchObject({ id: 8, result: {} });
  });

  it('answers an id-last oversized request by its top-level id and keeps the upstream', async () => {
    const { proxy, write, out, tick, input } = rig();
    const up = new FakeUpstream();
    let lost = 0;
    proxy.onLost = () => void lost++;
    proxy.attach(up);
    write({ jsonrpc: '2.0', id: 3, method: 'pending' });
    input.write(
      `{"jsonrpc":"2.0","method":"x","params":{"id":99,"s":"${'a'.repeat(MAX_RELAY_LINE_BYTES + 5)}","t":"q\\"id\\":5"},"id":4}\n`,
    );
    write({ jsonrpc: '2.0', id: 5, method: 'next' });
    await tick();
    expect(lost).toBe(0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 4, error: { code: -32600 } });
    expect(up.sent.map((m) => m.id)).toEqual([3, 5]);
  });

  it('drops an oversized line with no top-level id silently and keeps going', async () => {
    const { proxy, write, out, tick, input } = rig();
    const up = new FakeUpstream();
    proxy.attach(up);
    input.write(
      `{"jsonrpc":"2.0","method":"x","params":{"id":99,"s":"${'a'.repeat(MAX_RELAY_LINE_BYTES + 5)}"}}\n`,
    );
    write({ jsonrpc: '2.0', id: 6, method: 'next' });
    await tick();
    expect(out).toHaveLength(0);
    expect(up.sent.map((m) => m.id)).toEqual([6]);
  });

  it('LocalUpstream.close tells the proxy', async () => {
    const [, b] = InMemoryTransport.createLinkedPair();
    const up = new LocalUpstream(b);
    let closed = 0;
    up.onClose = () => void closed++;
    up.close();
    up.close();
    expect(closed).toBe(1);
  });
});

describe('StdioRelayProxy replay id', () => {
  it('round-trips a client request whose id looks like an internal one, before and after takeover', async () => {
    const { proxy, write, out, tick } = rig();
    const up = new FakeUpstream();
    proxy.attach(up);
    const id = 'relay-replay-initialize';
    write({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} });
    write({ jsonrpc: '2.0', method: 'notifications/initialized' });
    write({ jsonrpc: '2.0', id, method: 'tools/list' });
    await tick();
    up.onMessage?.({ jsonrpc: '2.0', id, result: { tools: [] } });
    expect(out.at(-1)).toMatchObject({ id, result: { tools: [] } });
    expect(proxy.pendingCount).toBe(1); // only the initialize is still open

    up.close();
    const next = new FakeUpstream();
    proxy.attach(next);
    // The replayed initialize uses a private id and is never shown to the client.
    const replayId = next.sent[0]!.id;
    expect(replayId).not.toBe(id);
    write({ jsonrpc: '2.0', id, method: 'tools/list' });
    await tick();
    const before = out.length;
    next.onMessage?.({ jsonrpc: '2.0', id: replayId, result: {} });
    expect(out).toHaveLength(before);
    next.onMessage?.({ jsonrpc: '2.0', id, result: { tools: [1] } });
    expect(out.at(-1)).toMatchObject({ id, result: { tools: [1] } });
    expect(proxy.pendingCount).toBe(0);
  });
});

describe('StdioRelayProxy stdout back-pressure', () => {
  const big = 'r'.repeat(200 * 1024);
  const tick = () => new Promise((r) => setTimeout(r, 20));
  /** A proxy whose client never reads stdout (the readable side is never consumed). */
  function stuck() {
    const input = new PassThrough();
    const output = new PassThrough();
    const proxy = new StdioRelayProxy(input, output);
    let gone = 0;
    proxy.onClientGone = () => void gone++;
    proxy.start();
    const write = (m: object) => input.write(`${JSON.stringify(m)}\n`);
    return { input, output, proxy, write, gone: () => gone };
  }
  /** An upstream that answers every request with a result of `size` bytes. */
  function answering(size: number) {
    const up = new FakeUpstream();
    const payload = 'r'.repeat(size);
    const base = up.send.bind(up);
    up.send = (m) => {
      base(m);
      if (m.id !== undefined)
        queueMicrotask(() => up.onMessage?.({ jsonrpc: '2.0', id: m.id, result: { payload } }));
      return true;
    };
    return up;
  }

  it('pauses stdin on a stalled stdout, stays bounded over 400 requests, and recovers on drain', async () => {
    const { input, output, proxy, write, gone } = stuck();
    const up = answering(20 * 1024);
    let paused = 0;
    let resumed = 0;
    up.pause = () => void paused++;
    up.resume = () => void resumed++;
    proxy.attach(up);
    const rss = process.memoryUsage().rss;
    for (let i = 0; i < 400; i++) write({ jsonrpc: '2.0', id: i, method: 'x' });
    await tick();
    expect(input.isPaused()).toBe(true);
    expect(paused).toBe(1);
    expect(output.listenerCount('drain')).toBe(1);
    expect(up.sent.length).toBeLessThan(400); // stdin stopped feeding the session
    expect(output.writableLength).toBeLessThanOrEqual(MAX_RELAY_BUFFERED_BYTES);
    expect(process.memoryUsage().rss - rss).toBeLessThan(64 * 1024 * 1024);
    expect(gone()).toBe(0);
    // The client reads again: everything resumes and every request is eventually answered.
    const got = new Set<unknown>();
    let buf = '';
    output.on('data', (d: Buffer) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        got.add((JSON.parse(buf.slice(0, i)) as RpcMessage).id);
        buf = buf.slice(i + 1);
      }
    });
    for (let n = 0; n < 200 && got.size < 400; n++) await tick();
    expect(got.size).toBe(400);
    expect(resumed).toBeGreaterThan(0);
    expect(gone()).toBe(0);
  }, 20_000);

  it('drops the session once more than the cap is queued unread, and stays bounded', async () => {
    const { input, output, proxy, write, gone } = stuck();
    const up = new FakeUpstream(); // ignores pause(), like an in-process session
    let closed = 0;
    const origClose = up.close.bind(up);
    up.close = () => (closed++, origClose());
    proxy.attach(up);
    write({ jsonrpc: '2.0', id: 1, method: 'x' });
    await tick();
    const rss = process.memoryUsage().rss;
    for (let i = 0; i < 100; i++)
      up.onMessage?.({ jsonrpc: '2.0', method: 'notifications/message', params: { big } });
    expect(gone()).toBe(1);
    expect(closed).toBeGreaterThan(0);
    expect(proxy.pendingCount).toBe(0);
    expect(input.listenerCount('data')).toBe(0);
    expect(output.listenerCount('drain')).toBe(0);
    expect(output.writableLength).toBeLessThanOrEqual(MAX_RELAY_BUFFERED_BYTES);
    expect(process.memoryUsage().rss - rss).toBeLessThan(64 * 1024 * 1024);
  });

  it('applies RELAY_BUSY replies to the same cap', async () => {
    const { proxy, write, output } = stuck();
    proxy.attach(new FakeUpstream()); // never answers
    for (let i = 0; i < MAX_RELAY_PENDING; i++) write({ jsonrpc: '2.0', id: i, method: 'x' });
    for (let i = 0; i < 20000; i++) write({ jsonrpc: '2.0', id: `b${i}`, method: 'x' });
    await tick();
    expect(output.writableLength).toBeLessThanOrEqual(MAX_RELAY_BUFFERED_BYTES);
  });

  it('through a LocalUpstream after takeover: dropped at the cap, shared server and other sessions untouched', async () => {
    const { proxy, write, gone } = stuck();
    const first = new FakeUpstream();
    proxy.attach(first);
    first.close(); // the old primary went away
    // One shared server end with two independent sessions.
    const [a, b] = InMemoryTransport.createLinkedPair();
    const [c, d] = InMemoryTransport.createLinkedPair();
    a.onmessage = (m) => {
      const id = (m as { id: number }).id;
      for (let i = 0; i < 60; i++)
        a.send({ jsonrpc: '2.0', id, result: { big } }).catch(() => undefined);
    };
    c.onmessage = (m) =>
      void c.send({ jsonrpc: '2.0', id: (m as { id: number }).id, result: 'ok' });
    const other: unknown[] = [];
    d.onmessage = (m) => void other.push(m);
    await Promise.all([a.start(), c.start(), d.start()]);
    const local = new LocalUpstream(b);
    await local.start();
    proxy.attach(local);
    for (let i = 0; i < 10; i++) write({ jsonrpc: '2.0', id: i, method: 'x' });
    await tick();
    expect(gone()).toBe(1);
    await d.send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    await tick();
    expect(other).toHaveLength(1);
  });
});
