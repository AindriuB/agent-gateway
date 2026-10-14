/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

const CODE = 'ABCD-EFGH-JKMN';
const ADDR = 'wss://gw.example.com/link';
const NS = 'agent-gateway';

async function setup(o: { world?: string; isGM?: boolean } = {}) {
  vi.resetModules();
  const g = globalThis as any;
  const store: Record<string, string> = { gatewayUrl: '', defaultGatewayUrl: o.world ?? '' };
  const onChange: Record<string, (v: unknown, o?: unknown, u?: string) => Promise<void>> = {};
  const log: string[] = [];
  const setSpy = vi.fn();
  const writes: string[] = []; // every value handed to the database write, as Foundry encodes it
  const pre: Record<string, Array<(d: any, c: any, o: any, u: string) => void>> = {};
  g.Hooks = { on: (n: string, f: any) => (pre[n] ??= []).push(f) };
  g.game = {
    user: { id: 'u1', isGM: o.isGM ?? true },
    i18n: { localize: (k: string) => `L:${k}`, format: (k: string) => k },
    settings: {
      register: (_ns: string, key: string, cfg: any) => {
        if (cfg.onChange) onChange[key] = cfg.onChange;
      },
      registerMenu: () => {},
      get: (_ns: string, key: string) => store[key] ?? '',
      set: async (_ns: string, key: string, v: string) => {
        setSpy(key, v);
        log.push(`set:${key}=${v}`);
        await Promise.resolve();
        let out = v;
        if (key === 'defaultGatewayUrl') {
          const data = { key: `${NS}.${key}`, value: JSON.stringify(v) };
          const hook = store[key] === '' ? 'preCreateSetting' : 'preUpdateSetting';
          pre[hook]?.forEach((f) => f({ key: data.key }, data, {}, 'u1'));
          writes.push(data.value);
          out = JSON.parse(data.value);
        }
        store[key] = out;
        await onChange[key]?.(out, {}, 'u1'); // Foundry runs onChange after the write
      },
    },
  };
  const warn = vi.fn();
  g.ui = { notifications: { warn, info: vi.fn() } };
  const client = { pair: vi.fn((c: string) => log.push(`pair:${c}`)), start: vi.fn() };
  vi.doMock('../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
  const err = vi.spyOn(console, 'error').mockImplementation(() => {});
  const { registerSettings } = await import('../../src/settings/index.js');
  registerSettings();
  err.mockRestore();
  const paste = async (key: string, v: string, userId?: string) => {
    store[key] = v;
    log.length = 0;
    setSpy.mockClear();
    await onChange[key]!(v, {}, userId);
  };
  return { store, log, warn, client, setSpy, paste, writes, pre };
}

afterEach(() => {
  vi.doUnmock('../../src/link/runtime.js');
  delete (globalThis as any).game;
  delete (globalThis as any).ui;
});

const noHash = (store: Record<string, string>) =>
  Object.values(store).forEach((v) => expect(v).not.toContain('#'));

describe('client gatewayUrl guard', () => {
  it('stores only the address, then pairs once', async () => {
    const t = await setup();
    await t.paste('gatewayUrl', `${ADDR}#${CODE}`);
    expect(t.log).toEqual([`set:gatewayUrl=${ADDR}`, `pair:${CODE}`]);
    expect(t.store.gatewayUrl).toBe(ADDR);
    expect(t.client.pair).toHaveBeenCalledTimes(1);
    noHash(t.store);
  });

  it('stores an empty override when the address is the world default', async () => {
    const t = await setup({ world: ADDR });
    await t.paste('gatewayUrl', `${ADDR}#${CODE}`);
    expect(t.store.gatewayUrl).toBe('');
    expect(t.client.pair).toHaveBeenCalledTimes(1);
    noHash(t.store);
  });

  it.each([
    'wss://gw.example.com/link#NOPE',
    'wss://u:p@gw.example.com/link#x',
    'ws:\\u:p@evil.com/link',
    'wss://gw.example.com/link?a=1#frag',
  ])('resets an invalid value %s with one notice that does not echo it', async (v) => {
    const t = await setup();
    await t.paste('gatewayUrl', v);
    expect(t.store.gatewayUrl).toBe('');
    expect(t.client.pair).not.toHaveBeenCalled();
    expect(t.client.start).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.warn.mock.calls[0]![0]).not.toContain('evil');
    expect(t.warn.mock.calls[0]![0]).not.toContain('gw.example');
    noHash(t.store);
  });

  it('leaves a plain valid address alone', async () => {
    const t = await setup();
    await t.paste('gatewayUrl', 'ws://gw');
    expect(t.setSpy).not.toHaveBeenCalled();
    expect(t.warn).not.toHaveBeenCalled();
    expect(t.store.gatewayUrl).toBe('ws://gw');
  });

  it('does not loop: the corrective write re-enters and does nothing more', async () => {
    const t = await setup();
    t.store.gatewayUrl = `${ADDR}#${CODE}`;
    t.setSpy.mockClear();
    await (globalThis as any).game.settings.set(NS, 'gatewayUrl', `${ADDR}#${CODE}`);
    // the user's write, then exactly one corrective write
    expect(t.setSpy).toHaveBeenCalledTimes(2);
    expect(t.client.pair).toHaveBeenCalledTimes(1);
  });
});

describe('world defaultGatewayUrl guard', () => {
  it('drops the code, keeps the address, warns without the code, never pairs', async () => {
    const t = await setup();
    await t.paste('defaultGatewayUrl', `${ADDR}#${CODE}`);
    expect(t.store.defaultGatewayUrl).toBe(ADDR);
    expect(t.client.pair).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.warn.mock.calls[0]![0]).not.toContain(CODE);
    noHash(t.store);
  });

  it.each(['http://gw.example.com', 'ws://gw.example.com'])(
    'resets invalid %s with one notice that does not echo it',
    async (v) => {
      const t = await setup();
      await t.paste('defaultGatewayUrl', v);
      expect(t.store.defaultGatewayUrl).toBe('');
      expect(t.warn).toHaveBeenCalledTimes(1);
      expect(t.warn.mock.calls[0]![0]).not.toContain('gw.example');
      noHash(t.store);
    },
  );

  it('does nothing on a non-GM client', async () => {
    const t = await setup({ isGM: false });
    await t.paste('defaultGatewayUrl', `${ADDR}#${CODE}`);
    expect(t.setSpy).not.toHaveBeenCalled();
    expect(t.warn).not.toHaveBeenCalled();
  });

  it.each([
    [`${ADDR}#${CODE}`, ADDR],
    [CODE, ''],
    ['http://gw.example.com', ''],
    [`${ADDR}#${CODE}`.replace('wss', 'ws'), ''],
  ])('the data passed to the write never carries the code: %s', async (v, want) => {
    for (const world of ['', ADDR]) {
      const t = await setup({ world }); // '' takes preCreateSetting, a value takes preUpdateSetting
      await (globalThis as any).game.settings.set(NS, 'defaultGatewayUrl', v);
      expect(t.writes).toEqual([JSON.stringify(want)]);
      expect(t.writes[0]).not.toContain(CODE);
      expect(t.writes[0]).not.toContain('#');
      expect(t.setSpy).toHaveBeenCalledTimes(1); // no corrective write is needed
      expect(t.warn).toHaveBeenCalledTimes(1);
      expect(t.warn.mock.calls[0]![0]).not.toContain(CODE);
    }
  });

  it('rewrites the pending value in place on both hooks', async () => {
    const t = await setup();
    for (const hook of ['preCreateSetting', 'preUpdateSetting']) {
      const data = { key: `${NS}.defaultGatewayUrl`, value: JSON.stringify(`${ADDR}#${CODE}`) };
      t.pre[hook]!.forEach((f) => f({}, data, {}, 'u1'));
      expect(data.value).toBe(JSON.stringify(ADDR));
    }
  });

  it('leaves other settings and other writers alone', async () => {
    const t = await setup();
    const other = { key: `${NS}.gatewayUrl`, value: JSON.stringify(`${ADDR}#${CODE}`) };
    const mine = { key: `${NS}.defaultGatewayUrl`, value: JSON.stringify(`${ADDR}#${CODE}`) };
    t.pre.preUpdateSetting!.forEach((f) => f({}, other, {}, 'u1'));
    t.pre.preUpdateSetting!.forEach((f) => f({}, mine, {}, 'u2'));
    expect(other.value).toContain(CODE);
    expect(mine.value).toContain(CODE);
    expect(t.warn).not.toHaveBeenCalled();
  });

  it('onChange does nothing for a value another user wrote', async () => {
    const t = await setup();
    await t.paste('defaultGatewayUrl', `${ADDR}#${CODE}`, 'u2');
    expect(t.setSpy).not.toHaveBeenCalled();
    expect(t.warn).not.toHaveBeenCalled();
  });

  it('needs no corrective write once the hook has cleaned the value', async () => {
    const t = await setup();
    t.setSpy.mockClear();
    await (globalThis as any).game.settings.set(NS, 'defaultGatewayUrl', `${ADDR}#${CODE}`);
    expect(t.setSpy).toHaveBeenCalledTimes(1);
    expect(t.warn).toHaveBeenCalledTimes(1);
  });
});
