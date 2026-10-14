/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';

const CODE = 'ABCD-EFGH-JKMN';
const ADDR = 'wss://gw.example.com/link';
const NS = 'agent-gateway';

async function setup(o: { world?: string; isGM?: boolean } = {}) {
  vi.resetModules();
  const g = globalThis as any;
  const store: Record<string, string> = { gatewayUrl: '', defaultGatewayUrl: o.world ?? '' };
  const onChange: Record<string, (v: unknown) => Promise<void>> = {};
  const log: string[] = [];
  const setSpy = vi.fn();
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
        store[key] = v;
        await onChange[key]?.(v); // Foundry runs onChange after the write
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
  const paste = async (key: string, v: string) => {
    store[key] = v;
    log.length = 0;
    setSpy.mockClear();
    await onChange[key]!(v);
  };
  return { store, log, warn, client, setSpy, paste };
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

  it('does not loop on its own corrective write', async () => {
    const t = await setup();
    t.setSpy.mockClear();
    await (globalThis as any).game.settings.set(NS, 'defaultGatewayUrl', `${ADDR}#${CODE}`);
    expect(t.setSpy).toHaveBeenCalledTimes(2);
    expect(t.warn).toHaveBeenCalledTimes(1);
  });
});
