/* eslint-disable @typescript-eslint/no-explicit-any */
import { MAX_FRAME_BYTES, PROTOCOL_VERSION, defineTool } from '@agent-gateway/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAuditStage } from '../../src/audit/stage.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { installBridge } from '../../src/link/bridge.js';
import { LinkClient, type CallResult, type SocketLike } from '../../src/link/client.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import type { DispatchResult, OpCall, OpUser } from '../../src/ops/types.js';
import { makeStore } from '../audit/fake.js';

class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  readyState = 1;
  raw: string[] = [];
  send(d: string) {
    this.raw.push(d);
  }
  get sent(): any[] {
    return this.raw.map((r) => JSON.parse(r));
  }
  close() {}
  recv(m: object) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

let socket: FakeSocket;
let client: LinkClient;
let dispatch: ReturnType<typeof vi.fn<(c: OpCall, u: OpUser) => Promise<DispatchResult>>>;
const flush = () => new Promise((r) => setTimeout(r, 0));
const png = (n: number) => Buffer.alloc(n, 1).toString('base64');
const image = (data = png(30)) => ({ mimeType: 'image/png' as const, data });
const call = { type: 'call', id: 'c1', sessionId: 's', tool: 't', args: {} };

beforeEach(async () => {
  socket = new FakeSocket();
  dispatch = vi.fn(async () => ({ text: 'done', structured: { ok: 1 } }));
  client = new LinkClient({
    getGatewayUrl: () => 'ws://gw',
    getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
    setToken: () => {},
    getIdentity: () => ({
      moduleVersion: '0',
      foundryVersion: '14',
      world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
      user: { id: 'p', name: 'P', role: 1, isGM: false },
    }),
    createSocket: () => socket,
    notifyError: () => {},
  });
  installBridge(client, { dispatch, getUser: () => ({ id: 'p', isGM: false }) });
  client.start();
  socket.onopen?.();
  socket.recv({
    type: 'welcome',
    gatewayVersion: '0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c',
    agentId: 'a',
  });
  await flush();
});

describe('result frame images', () => {
  it('copies OpResult.images through the bridge into the result frame', async () => {
    const img = image();
    dispatch.mockResolvedValueOnce({ text: 'seen', structured: {}, images: [img] });
    socket.recv(call);
    await flush();
    expect(socket.sent.at(-1)).toEqual({
      type: 'result',
      id: 'c1',
      ok: true,
      text: 'seen',
      structured: {},
      images: [img],
    });
  });

  it('forwards images from a handler CallResult, and omits the key when there are none', async () => {
    const img = image();
    const withImg: CallResult = { ok: true, text: 'a', images: [img] };
    client.onCall = () => withImg;
    socket.recv(call);
    await flush();
    expect(socket.sent.at(-1)).toEqual({
      type: 'result',
      id: 'c1',
      ok: true,
      text: 'a',
      images: [img],
    });

    client.onCall = () => ({ ok: true, text: 'a' });
    socket.recv(call);
    await flush();
    expect(socket.raw.at(-1)).toBe('{"type":"result","id":"c1","ok":true,"text":"a"}');

    client.onCall = () => ({ ok: true, text: 'a', images: [] });
    socket.recv(call);
    await flush();
    expect(socket.raw.at(-1)).toBe('{"type":"result","id":"c1","ok":true,"text":"a"}');
  });

  it('sends an INVALID_ARGS error naming the size when the frame is over the limit', async () => {
    client.onCall = () => ({ ok: true, text: 'a', images: [image(png(MAX_FRAME_BYTES))] });
    socket.recv(call);
    await flush();
    const last = socket.sent.at(-1);
    expect(last).toMatchObject({ type: 'error', id: 'c1', code: 'INVALID_ARGS' });
    expect(last.message).toMatch(/\d{7} bytes/);
    expect(socket.raw.at(-1)!.length).toBeLessThan(MAX_FRAME_BYTES);
  });

  it('keeps base64 out of the audit entry for an image result', async () => {
    const data = png(300);
    const tools = [
      defineTool({
        name: 'img_write',
        minRole: 'player',
        category: 'write',
        handledBy: 'module',
        description: 'x',
        input: z.strictObject({}),
        output: z.strictObject({}),
      }),
    ];
    const records: AuditRecord[] = [];
    const stage = createAuditStage({
      isGM: () => true,
      categoryOf: () => 'write',
      fromUuid: makeStore().fromUuid,
      submit: async (r) => void records.push(r),
      now: () => 1,
      newId: () => 'entry-abcdef01',
    });
    const d = createDispatcher({
      tools,
      handlers: {
        img_write: async () => ({ text: 'seen\nmore', structured: {}, images: [image(data)] }),
      },
      stages: [stage],
    });
    await d(
      {
        tool: 'img_write',
        args: {},
        agent: { id: 'a', ownerUserId: 'p', headless: false },
        sessionId: 's',
      },
      { id: 'p', isGM: false },
    );
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records[0])).not.toContain(data);
    expect(records[0]!.result).toBe('seen');
  });
});
