import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  MAX_RELAY_PENDING,
  StdioRelayProxy,
  type RpcMessage,
  type Upstream,
} from '../../src/relay/index.js';

class FakeUpstream implements Upstream {
  onMessage?: (m: RpcMessage) => void;
  onClose?: () => void;
  sent: RpcMessage[] = [];
  send(m: RpcMessage): boolean {
    this.sent.push(m);
    return true;
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
  proxy.start();
  const write = (m: object) => input.write(`${JSON.stringify(m)}\n`);
  const tick = () => new Promise((r) => setTimeout(r, 10));
  return { proxy, write, out, tick };
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
