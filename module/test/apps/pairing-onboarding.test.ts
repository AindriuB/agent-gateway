/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  vi.doUnmock('../../src/link/runtime.js');
});

const CODE = 'ABCD-EFGH-JKMN';
const WORLD = 'wss://gw.example.com/link';
const NS = 'agent-gateway';
const root = resolve(__dirname, '../../..');
const lang = JSON.parse(readFileSync(resolve(root, 'lang/en.json'), 'utf8')) as any;

interface Opts {
  client?: string;
  world?: string;
  token?: string;
  state?: any;
  isGM?: boolean;
}

async function setup(o: Opts = {}) {
  vi.resetModules();
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.i18n = {
    localize: (k: string) => `L:${k}`,
    format: (k: string, d: Record<string, string>) => `F:${k}:${JSON.stringify(d)}`,
  };
  g.game.world = { id: 'w1' };
  g.game.user = { id: 'u1', isGM: o.isGM ?? false };
  const log: string[] = [];
  const warn = vi.fn();
  g.ui = { notifications: { warn, info: vi.fn() } };
  g.game.settings.register(NS, 'gatewayUrl', { scope: 'client', type: String, default: '' });
  g.game.settings.register(NS, 'defaultGatewayUrl', { scope: 'world', type: String, default: '' });
  g.game.settings.register(NS, 'pairingCredential', { scope: 'client', type: String, default: '' });
  if (o.client !== undefined) await g.game.settings.set(NS, 'gatewayUrl', o.client);
  if (o.world !== undefined) await g.game.settings.set(NS, 'defaultGatewayUrl', o.world);
  if (o.token) await g.game.settings.set(NS, 'pairingCredential', o.token);
  const realSet = g.game.settings.set;
  g.game.settings.set = async (ns: string, key: string, v: unknown) => {
    log.push(`set:${key}=${String(v)}`);
    await Promise.resolve();
    return realSet(ns, key, v);
  };
  let fire: () => void = () => {};
  const client = {
    pair: vi.fn((c: string) => log.push(`pair:${c}`)),
    start: vi.fn(() => log.push('start')),
    state: (o.state ?? { kind: 'disconnected' }) as any,
    hasStoredToken: () => !!o.token,
    onState: (fn: () => void) => {
      fire = fn;
      return () => {};
    },
  };
  vi.doMock('../../src/link/runtime.js', () => ({ getLinkClient: () => client }));
  const mod = await import('../../src/apps/pairing/index.js');
  const App = mod.createPairingApp();
  const submit = (values: Record<string, string>) =>
    App.onSubmit(new Event('submit'), {} as HTMLFormElement, { object: values });
  const stored = (key = 'gatewayUrl') => g.game.settings.get(NS, key);
  return { mod, App, client, log, warn, submit, stored, fire: () => fire(), g };
}

describe('paste routing', () => {
  it('a valid invite in the code field ignores the URL field, writes the address, then pairs', async () => {
    const t = await setup({ client: 'ws://old' });
    await t.submit({ gatewayUrl: 'ws://typed', code: ` ${WORLD}#${CODE.toLowerCase()} ` });
    expect(t.log).toEqual([`set:gatewayUrl=${WORLD}`, `pair:${CODE}`]);
    expect(t.stored()).toBe(WORLD);
    expect(t.stored()).not.toContain('#');
  });

  it('a valid invite in the URL field works the same, ignoring the code field', async () => {
    const t = await setup();
    await t.submit({ gatewayUrl: `${WORLD}#${CODE}`, code: 'other' });
    expect(t.log).toEqual([`set:gatewayUrl=${WORLD}`, `pair:${CODE}`]);
  });

  it('an invite for the world default stores an empty override', async () => {
    const t = await setup({ client: 'ws://old', world: WORLD });
    await t.submit({ gatewayUrl: '', code: `${WORLD}#${CODE}` });
    expect(t.log).toEqual(['set:gatewayUrl=', `pair:${CODE}`]);
  });

  it('awaits the write before pairing', async () => {
    const t = await setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const realSet = t.g.game.settings.set;
    t.g.game.settings.set = async (...a: unknown[]) => {
      await gate;
      return realSet(...a);
    };
    const p = t.submit({ gatewayUrl: '', code: `${WORLD}#${CODE}` });
    await Promise.resolve();
    expect(t.client.pair).not.toHaveBeenCalled();
    release();
    await p;
    expect(t.client.pair).toHaveBeenCalledWith(CODE);
  });

  it.each([
    ['javascript', `javascript:alert(1)#${CODE}`],
    ['wrong scheme', `https://gw/link#${CODE}`],
    ['no code', 'wss://gw/link'],
    ['query', `wss://gw/link?x=1#${CODE}`],
    ['credentials', `wss://u:p@gw/link#${CODE}`],
    ['script', 'wss://gw/link#<script>'],
  ])('an invalid invite (%s) in the code field changes nothing and warns once', async (_n, bad) => {
    const t = await setup({ client: 'ws://old', token: 'tok' });
    await t.submit({ gatewayUrl: 'ws://new', code: bad });
    expect(t.log).toEqual([]);
    expect(t.stored()).toBe('ws://old');
    expect(t.client.pair).not.toHaveBeenCalled();
    expect(t.client.start).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.Invite.invalid');
    expect(JSON.stringify(t.warn.mock.calls)).not.toContain(bad);
  });

  it('an invalid invite in the URL field changes nothing and warns once', async () => {
    const t = await setup({ client: 'ws://old' });
    await t.submit({ gatewayUrl: `https://gw/link#${CODE}`, code: '' });
    expect(t.log).toEqual([]);
    expect(t.warn).toHaveBeenCalledTimes(1);
    expect(t.client.pair).not.toHaveBeenCalled();
  });

  it('a typed address with credentials is refused and nothing is sent', async () => {
    const t = await setup({ client: 'ws://old' });
    await t.submit({ gatewayUrl: 'wss://u:p@gw/link', code: 'abc' });
    expect(t.log).toEqual([]);
    expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.Address.invalid');
    expect(t.client.pair).not.toHaveBeenCalled();
  });

  it('a bare code is paired against the URL field', async () => {
    const t = await setup();
    await t.submit({ gatewayUrl: 'ws://gw', code: ' abc ' });
    expect(t.log).toEqual(['set:gatewayUrl=ws://gw', 'pair:abc']);
  });

  it('an empty URL field clears the override instead of returning silently', async () => {
    const t = await setup({ client: 'ws://old', world: WORLD });
    await t.submit({ gatewayUrl: '', code: '' });
    expect(t.stored()).toBe('');
    expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.Server.codeRequired');
  });

  it('a typed URL equal to the world default is stored empty', async () => {
    const t = await setup({ world: WORLD });
    await t.submit({ gatewayUrl: WORLD, code: 'abc' });
    expect(t.log).toEqual(['set:gatewayUrl=', 'pair:abc']);
  });

  it('with a stored token and no code it reclaims via start()', async () => {
    const t = await setup({ token: 'tok', client: 'ws://gw' });
    await t.submit({ gatewayUrl: 'ws://gw', code: '' });
    expect(t.log).toEqual(['set:gatewayUrl=ws://gw', 'start']);
  });
});

describe('wording', () => {
  it('local mode keeps every existing key', async () => {
    const t = await setup({ client: 'ws://localhost:7420' });
    const ctx: any = await new t.App()._prepareContext();
    expect(ctx.serverMode).toBe(false);
    expect(ctx.codeLabel).toBe('L:AGENT_GATEWAY.Pairing.code');
    expect(ctx.codeHint).toBe('L:AGENT_GATEWAY.Pairing.codeHint');
    expect(ctx.serverLine).toBe('');
    const d = t.mod.describeState;
    expect(d({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' }, false)).toBe(
      'L:AGENT_GATEWAY.Link.pairingRequired',
    );
    expect(d({ kind: 'disconnected', reason: 'PAIRING_INVALID' }, false)).toBe(
      'L:AGENT_GATEWAY.Link.pairingInvalid',
    );
    expect(d({ kind: 'connecting', codeRejected: true }, false)).toBe(
      'L:AGENT_GATEWAY.Link.pairingInvalid',
    );
    await t.submit({ gatewayUrl: 'ws://localhost:7420', code: '' });
    expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Link.codeRequired');
  });

  it('server mode talks about invites', async () => {
    const t = await setup({ world: WORLD });
    const ctx: any = await new t.App()._prepareContext();
    expect(ctx.serverMode).toBe(true);
    expect(ctx.codeLabel).toBe('L:AGENT_GATEWAY.Pairing.Invite.label');
    expect(ctx.codeHint).toBe('L:AGENT_GATEWAY.Pairing.Invite.hint');
    expect(ctx.serverLine).toBe('L:AGENT_GATEWAY.Pairing.Server.line');
    const d = t.mod.describeState;
    expect(d({ kind: 'disconnected', reason: 'PAIRING_REQUIRED' }, true)).toBe(
      'L:AGENT_GATEWAY.Pairing.Server.pairingRequired',
    );
    expect(d({ kind: 'disconnected', reason: 'PAIRING_INVALID' }, true)).toBe(
      'L:AGENT_GATEWAY.Pairing.Server.pairingInvalid',
    );
    expect(d({ kind: 'connecting', codeRejected: true }, true)).toBe(
      'L:AGENT_GATEWAY.Pairing.Server.pairingInvalid',
    );
    await t.submit({ gatewayUrl: '', code: '' });
    expect(t.warn).toHaveBeenCalledWith('L:AGENT_GATEWAY.Pairing.Server.codeRequired');
  });
});

describe('address and hint', () => {
  it('shows a display-safe address and says when it is inherited', async () => {
    const t = await setup({ world: WORLD });
    const ctx: any = await new t.App()._prepareContext();
    expect(ctx.address).toBe(
      `F:AGENT_GATEWAY.Pairing.Address.inherited:${JSON.stringify({ address: WORLD })}`,
    );
    expect(ctx.gatewayUrl).toBe('');
  });

  it('shows the own address without the inherited note, and never userinfo, query or fragment', async () => {
    const t = await setup({ client: 'wss://gw.other.com:8443/link', world: WORLD });
    const ctx: any = await new t.App()._prepareContext();
    expect(ctx.address).toContain('Address.current');
    expect(ctx.address).toContain('wss://gw.other.com:8443/link');
    const bad = await setup({ client: 'wss://u:secret@gw.other.com/link?k=v#frag' });
    const c2: any = await new bad.App()._prepareContext();
    expect(c2.address).not.toMatch(/secret|k=v|frag/);
    expect(c2.urlWarning).toBe('L:AGENT_GATEWAY.Pairing.Address.invalid');
  });

  it('a legacy stored default shows as empty when the world default applies', async () => {
    const t = await setup({ client: 'ws://localhost:7420', world: WORLD });
    const ctx: any = await new t.App()._prepareContext();
    expect(ctx.gatewayUrl).toBe('');
    expect(ctx.address).toContain(WORLD);
  });

  it('warns a GM, and only a GM, about an invalid world default', async () => {
    const gm = await setup({ world: 'http://nope', isGM: true });
    expect(((await new gm.App()._prepareContext()) as any).worldWarning).toBe(
      'L:AGENT_GATEWAY.Pairing.Address.worldInvalid',
    );
    const player = await setup({ world: 'http://nope', isGM: false });
    expect(((await new player.App()._prepareContext()) as any).worldWarning).toBe('');
  });

  it('says it cannot reach the gateway while retrying, and connecting to it while connecting', async () => {
    const t = await setup({ world: WORLD, state: { kind: 'disconnected', reason: 'ERROR' } });
    const app = new t.App();
    const ctx: any = await app._prepareContext();
    expect(ctx.address).toContain('Address.unreachable');
    expect(ctx.address).toContain(WORLD);
    const address = { textContent: '' };
    const status = { textContent: '' };
    app.element = {
      querySelector: (q: string) =>
        q === '[data-role="address"]' ? address : q === '[data-role="status"]' ? status : null,
    };
    await app._onRender({}, {});
    t.client.state = { kind: 'connecting' };
    t.fire();
    expect(address.textContent).toContain('Address.connecting');
    expect(address.textContent).toContain(WORLD);
    t.client.state = { kind: 'disconnected', reason: 'ERROR' };
    t.fire();
    expect(address.textContent).toContain('Address.unreachable');
  });

  it('never renders the stored token or an in-flight code', async () => {
    const token = JSON.stringify({ url: WORLD, token: 'SECRET-TOKEN-VALUE' });
    const t = await setup({ world: WORLD, token });
    await t.submit({ gatewayUrl: '', code: 'INFLIGHT-CODE' });
    const ctx = JSON.stringify(await new t.App()._prepareContext());
    expect(ctx).not.toContain('SECRET-TOKEN-VALUE');
    expect(ctx).not.toContain('INFLIGHT-CODE');
  });
});

describe('world default reaches the link', () => {
  it('getLinkClient() opens its socket at the world default after pair()', async () => {
    vi.resetModules();
    stub = installFoundry(14);
    const g = globalThis as any;
    g.ui = { notifications: { error: vi.fn() } };
    for (const [k, scope] of [
      ['gatewayUrl', 'client'],
      ['defaultGatewayUrl', 'world'],
      ['pairingCredential', 'client'],
      ['pairingToken', 'client'],
    ] as const)
      g.game.settings.register(NS, k, { scope, type: String, default: '' });
    await g.game.settings.set(NS, 'defaultGatewayUrl', WORLD);
    const urls: string[] = [];
    g.WebSocket = class {
      constructor(u: string) {
        urls.push(u);
      }
      send() {}
      close() {}
    };
    const { getLinkClient } = await import('../../src/link/runtime.js');
    getLinkClient().pair('X');
    expect(urls).toEqual([WORLD]);
  });
});

describe('static checks', () => {
  it('the template and app render text only through {{ }} and textContent', () => {
    const tpl = readFileSync(resolve(root, 'templates/pairing/pairing.hbs'), 'utf8');
    const src = readFileSync(resolve(root, 'module/src/apps/pairing/index.ts'), 'utf8');
    expect(tpl).not.toContain('{{{');
    expect(src).not.toContain('innerHTML');
  });

  it('every new lang key the app and template use exists', () => {
    const tpl = readFileSync(resolve(root, 'templates/pairing/pairing.hbs'), 'utf8');
    const src = readFileSync(resolve(root, 'module/src/apps/pairing/index.ts'), 'utf8');
    const keys = new Set(
      [...(tpl + src).matchAll(/AGENT_GATEWAY\.[A-Za-z]+(?:\.[A-Za-z]+)+/g)].map((m) => m[0]),
    );
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      const v = key.split('.').reduce((o: any, k) => o?.[k], lang);
      expect(typeof v, key).toBe('string');
    }
  });
});
