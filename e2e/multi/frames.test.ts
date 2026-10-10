import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  FrameCounter,
  frameKind,
  isLinkUrl,
  waitFor,
  type PageLike,
  type WsLike,
} from './frames.js';

const call = JSON.stringify({
  type: 'call',
  id: '1',
  sessionId: 's',
  tool: 'world_info',
  args: {},
});
const welcome = JSON.stringify({ type: 'welcome', gatewayVersion: '1', protocolVersion: '1' });

describe('frameKind', () => {
  it('tells call frames from pings, welcomes and Foundry socket.io frames', () => {
    expect(frameKind(call)).toBe('call');
    expect(frameKind(welcome)).toBe('welcome');
    expect(frameKind('{"type":"ping"}')).toBe('ping');
    expect(frameKind('{"type":"reject","code":"X","message":"m"}')).toBe('reject');
    expect(frameKind('42["modifyDocument",{}]')).toBe('other');
    expect(frameKind('{not json')).toBe('other');
    expect(frameKind('{"type":"result"}')).toBe('other');
    expect(frameKind('{"nothing":1}')).toBe('other');
  });
  it('reads binary payloads', () => {
    expect(frameKind(Buffer.from(call))).toBe('call');
  });
});

describe('isLinkUrl', () => {
  it('matches the link port on ws and wss only', () => {
    expect(isLinkUrl('ws://localhost:7429', 7429)).toBe(true);
    expect(isLinkUrl('ws://localhost:7429/', 7429)).toBe(true);
    expect(isLinkUrl('wss://localhost:7429', 7429)).toBe(true);
    expect(isLinkUrl('ws://localhost:7420', 7429)).toBe(false);
    expect(isLinkUrl('wss://foundry.local/socket.io/?EIO=4', 7429)).toBe(false);
    expect(isLinkUrl('not a url', 7429)).toBe(false);
  });
});

function fakePage() {
  const page = new EventEmitter();
  const socket = (url: string) => {
    const ws = new EventEmitter();
    const w = Object.assign(ws, { url: () => url }) as unknown as WsLike & EventEmitter;
    page.emit('websocket', w);
    return w;
  };
  return { page: page as unknown as PageLike, socket };
}

describe('FrameCounter', () => {
  it('counts call frames on the link socket across reconnects, not pings or other sockets', () => {
    const { page, socket } = fakePage();
    const c = new FrameCounter(7429).attach(page);
    const link = socket('ws://localhost:7429');
    const foundry = socket('wss://foundry.local/socket.io/');
    link.emit('framereceived', { payload: welcome });
    link.emit('framereceived', { payload: '{"type":"ping"}' });
    link.emit('framereceived', { payload: call });
    link.emit('framereceived', { payload: call });
    foundry.emit('framereceived', { payload: call });
    link.emit('close');
    const again = socket('ws://localhost:7429');
    again.emit('framereceived', { payload: welcome });
    again.emit('framereceived', { payload: call });
    expect(c.snapshot).toEqual({ calls: 3, welcomes: 2, closes: 1 });
    expect(c.calls).toBe(3);
  });
});

describe('waitFor', () => {
  it('returns the elapsed time when ready and undefined on timeout', async () => {
    let n = 0;
    expect(await waitFor(() => ++n >= 3, 1000, 5)).toBeGreaterThanOrEqual(0);
    expect(await waitFor(() => false, 30, 5)).toBeUndefined();
  });
});
