/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { receiveNotification } from '../../../src/tools/notify-receiver.js';
import { notifyHandler } from '../../../src/tools/notify.js';
const g = globalThis as any;
const saved = new Map<string, any>();
afterEach(() => {
  for (const [k, v] of saved) g[k] = v;
  saved.clear();
});
function set(k: string, v: any) {
  if (!saved.has(k)) saved.set(k, g[k]);
  g[k] = v;
}
function fixture(generation = 14) {
  const gm = { id: 'gm', isGM: true, active: true },
    player = { id: 'p', isGM: false, active: true };
  const users = [gm, player];
  const display = vi.fn();
  const socket = {
    on: vi.fn(),
    emit: vi.fn((_channel: any, _data: any, _options: any, ack: any) => ack()),
  };
  set('game', {
    user: player,
    users: { contents: users, get: (id: string) => users.find((u) => u.id === id) },
    release: { generation },
    socket,
    i18n: { localize: () => '<AI>' },
  });
  set('ui', { notifications: { info: display, warn: display, error: display } });
  const data = {
    kind: 'agent-gateway.notify',
    id: crypto.randomUUID(),
    level: 'info',
    message: '<img src=x onerror=x>@UUID[Actor.a]',
    recipients: ['p'],
  };
  const ctx: any = {
    user: gm,
    args: { message: 'hello', users: ['p'] },
    callOptions: { agentGateway: { callId: 'c' } },
    snapshot: vi.fn(),
    intendCreate: vi.fn(),
    created: vi.fn(),
  };
  return { gm, player, display, socket, data, ctx };
}
it('authenticates only separate native sender and escapes the complete prefix/message', () => {
  const f = fixture();
  receiveNotification(f.data, 'gm');
  expect(f.display).toHaveBeenCalledOnce();
  expect(f.display.mock.calls[0]![0]).not.toContain('<img');
  expect(f.display.mock.calls[0]![0]).toContain('&lt;AI&gt;');
});
it.each(['missing', 'forged', 'demoted', 'foreign', 'duplicate', 'inactive', 'oversized'])(
  'refuses %s notification',
  (mode) => {
    const f = fixture();
    let sender: any = 'gm';
    if (mode === 'missing') sender = undefined;
    if (mode === 'forged') sender = 'p';
    if (mode === 'demoted') f.gm.isGM = false;
    if (mode === 'foreign') f.data.recipients = ['gm'];
    if (mode === 'inactive') f.player.active = false;
    if (mode === 'oversized') f.data.message = 'x'.repeat(301);
    if (mode === 'duplicate') {
      receiveNotification(f.data, sender);
      f.display.mockClear();
    }
    receiveNotification(f.data, sender);
    expect(f.display).not.toHaveBeenCalled();
  },
);
it.each([13, 14])(
  'uses verified v%s targeted module relay without claiming display',
  async (generation) => {
    const f = fixture(generation);
    g.game.user = f.gm;
    expect(await notifyHandler(f.ctx)).toMatchObject({
      structured: { users: ['p'], relayed: true, local: false },
    });
    expect(f.socket.emit).toHaveBeenCalledWith(
      'module.agent-gateway',
      expect.objectContaining({ recipients: ['p'], message: 'hello' }),
      { recipients: ['p'] },
      expect.any(Function),
    );
    expect(f.display).not.toHaveBeenCalled();
  },
);
it('refuses GM drift after relay acknowledgement and reports no local display', async () => {
  const f = fixture();
  g.game.user = f.gm;
  f.ctx.args.users = ['gm', 'p'];
  f.socket.emit.mockImplementation((_c: any, _d: any, _o: any, ack: any) => {
    f.gm.isGM = false;
    ack();
  });
  expect(await notifyHandler(f.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.display).not.toHaveBeenCalled();
});
it('rejects duplicate or unknown recipients before relay', async () => {
  const f = fixture();
  g.game.user = f.gm;
  f.ctx.args.users = ['p', 'p'];
  expect(await notifyHandler(f.ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
  expect(f.socket.emit).not.toHaveBeenCalled();
});
it('rejects a very large receiver message before any display', () => {
  const f = fixture();
  f.data.message = 'x'.repeat(1000000);
  receiveNotification(f.data, 'gm');
  expect(f.display).not.toHaveBeenCalled();
});
it('rejects oversized native recipient IDs before lookup', () => {
  const f = fixture();
  f.data.recipients = ['x'.repeat(1000)];
  receiveNotification(f.data, 'gm');
  expect(f.display).not.toHaveBeenCalled();
});
