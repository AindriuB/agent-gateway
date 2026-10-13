import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  LocalUpstream,
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

  it('replaces the upstream when an oversized line has no visible id', async () => {
    const { proxy, write, out, tick, input } = rig();
    const up = new FakeUpstream();
    let lost = 0;
    proxy.onLost = () => void lost++;
    proxy.attach(up);
    write({ jsonrpc: '2.0', id: 3, method: 'pending' });
    input.write(
      `{"jsonrpc":"2.0","params":"${'a'.repeat(MAX_RELAY_LINE_BYTES + 5)}","id":4,"method":"x"}\n`,
    );
    await tick();
    expect(lost).toBe(1);
    expect(JSON.stringify(out.find((m) => m.id === 3))).toContain('RELAY_LOST');
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
