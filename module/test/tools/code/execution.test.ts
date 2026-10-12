/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { macroRun, scriptRun } from '@agent-gateway/protocol';
import { macroRunHandler } from '../../../src/tools/macro-run.js';
import { scriptRunHandler } from '../../../src/tools/script-run.js';
import { codeResult, parseCodeArgs } from '../../../src/tools/_code.js';
afterEach(() => vi.unstubAllGlobals());
function setup(pack = false, type = 'script') {
  const user: any = { id: 'gm', isGM: true };
  const macro: any = {
    id: 'm',
    documentName: 'Macro',
    uuid: pack ? 'Compendium.world.macros.Macro.m' : 'Macro.m',
    command: 'return args;',
    type,
    _stats: { modifiedTime: 1 },
    canUserExecute: vi.fn(() => true),
    canExecute: true,
    execute: vi.fn(async ({ args }: any) => args),
  };
  const collection: any = {
    collection: 'world.macros',
    documentName: 'Macro',
    get: (id: string) => (id === 'm' ? macro : undefined),
    testUserPermission: () => true,
  };
  if (pack) macro.pack = collection.collection;
  vi.stubGlobal('game', {
    user,
    users: { get: () => user },
    macros: pack ? { get: () => undefined } : collection,
    packs: { get: (id: string) => (id === collection.collection ? collection : undefined) },
    marker: 7,
  });
  vi.stubGlobal('canvas', { ready: true });
  vi.stubGlobal('ui', { marker: 9 });
  vi.stubGlobal('foundry', {
    utils: { parseUuid: () => ({ uuid: macro.uuid, type: 'Macro', embedded: [], collection }) },
  });
  const resolve = vi.fn(async () => macro);
  vi.stubGlobal('fromUuid', resolve);
  const ctx: any = {
    user: { id: 'gm', isGM: true },
    agent: { id: 'a', ownerUserId: 'gm', headless: false },
    sessionId: 's',
    tool: 'macro_run',
    args: { macroUuid: macro.uuid, args: '{"n":2}' },
    approved: true,
    callId: 'call',
    callOptions: { agentGateway: { callId: 'call' } },
  };
  return { user, macro, collection, ctx, resolve };
}
async function admitted(state: ReturnType<typeof setup>) {
  state.ctx.args = await macroRunHandler.admit!(state.ctx);
}
describe('native-shaped macro execution', () => {
  it.each([13, 14])('passes one fixed args binding to world script on v%s', async () => {
    const s = setup();
    const original = s.ctx.args;
    await admitted(s);
    expect(s.ctx.args).toEqual({ ...original, source: s.macro.command });
    expect(Object.isFrozen(s.ctx.args)).toBe(true);
    expect(original).not.toHaveProperty('source');
    expect(await macroRunHandler(s.ctx)).toMatchObject({ structured: { result: '{"n":2}' } });
    expect(s.macro.execute).toHaveBeenCalledWith({ args: { n: 2 } });
  });
  it('supports canonical cached compendium macros and refuses cache replacement', async () => {
    const s = setup(true);
    await admitted(s);
    expect(await macroRunHandler(s.ctx)).not.toHaveProperty('error');
    s.collection.get = () => ({ ...s.macro });
    expect(await macroRunHandler(s.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(s.macro.execute).toHaveBeenCalledTimes(1);
  });
  it('chat undefined is explicitly no returned value', async () => {
    const s = setup(false, 'chat');
    s.macro.execute.mockResolvedValue(undefined);
    await admitted(s);
    expect(await macroRunHandler(s.ctx)).toEqual({
      text: 'undefined',
      structured: { result: 'undefined', truncated: false },
    });
  });
  it.each(['command', 'type', 'stamp', 'permission', 'replacement', 'gm'])(
    'refuses changed %s while pending',
    async (kind) => {
      const s = setup();
      await admitted(s);
      if (kind === 'command') s.macro.command = 'return "other"';
      if (kind === 'type') s.macro.type = 'chat';
      if (kind === 'stamp') s.macro._stats.modifiedTime++;
      if (kind === 'permission') s.macro.canUserExecute.mockReturnValue(false);
      if (kind === 'replacement') s.collection.get = () => ({ ...s.macro });
      if (kind === 'gm') s.user.isGM = false;
      expect(await macroRunHandler(s.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(s.macro.execute).not.toHaveBeenCalled();
    },
  );
  it('demotion during resolution refuses admission', async () => {
    const s = setup();
    s.resolve.mockImplementation(async () => {
      s.user.isGM = false;
      return s.macro;
    });
    await expect(macroRunHandler.admit!(s.ctx)).rejects.toThrow('GM');
    expect(s.macro.execute).not.toHaveBeenCalled();
  });
  it('rejects caller source, excessive command and missing modification stamp', async () => {
    const s = setup();
    expect(macroRun.input.safeParse({ ...s.ctx.args, source: 'evil' }).success).toBe(false);
    s.macro.command = 'x'.repeat(20001);
    await expect(macroRunHandler.admit!(s.ctx)).rejects.toThrow('20000');
    s.macro.command = 'return 1';
    delete s.macro._stats.modifiedTime;
    await expect(macroRunHandler.admit!(s.ctx)).rejects.toThrow('changed');
  });
  it.each(['approved', 'callId', 'callOptions'])(
    'direct call lacking %s refuses both tools',
    async (key) => {
      const s = setup();
      await admitted(s);
      delete s.ctx[key];
      expect(await macroRunHandler(s.ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(
        await scriptRunHandler({ ...s.ctx, args: { source: 'throw "should not run"' } }),
      ).toMatchObject({ error: { code: 'FORBIDDEN' } });
    },
  );
});
describe('async scripts and bounded values', () => {
  it('awaits exact source with game/canvas/ui in scope', async () => {
    const s = setup();
    s.ctx.args = {
      source: 'await Promise.resolve(); return [game.marker, canvas.ready, ui.marker];',
    };
    expect(await scriptRunHandler(s.ctx)).toMatchObject({
      structured: { result: '[7,true,9]', truncated: false },
    });
    expect(scriptRun.input.safeParse({ source: 'x'.repeat(20001) }).success).toBe(false);
  });
  it.each([
    'throw new Error("specific")',
    'return await Promise.reject(new Error("specific"))',
    'const =',
  ])('returns only bounded error message for %s', async (source) => {
    const s = setup();
    const result: any = await scriptRunHandler({ ...s.ctx, args: { source } });
    expect(result.error.code).toBe('INTERNAL');
    expect(result.error.message).not.toMatch(/at |\.ts|stack/);
    if (source !== 'const =') expect(result.error.message).toBe('specific');
  });
  it('truncates long strings and serialises undefined explicitly', () => {
    expect(codeResult('x'.repeat(100000))).toMatchObject({
      truncated: true,
      result: expect.any(String),
    });
    expect(codeResult('x'.repeat(100000)).result.length).toBe(4000);
    expect(codeResult(undefined).result).toBe('undefined');
  });
  it('rejects accessors/toJSON/cycles/unsafe keys/nonfinite/exotic/sparse data without invoking callbacks', () => {
    const getter = vi.fn();
    const value = Object.defineProperty({}, 'x', { enumerable: true, get: getter });
    expect(() => codeResult(value)).toThrow('accessors');
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn();
    expect(() => codeResult({ toJSON })).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    const cycle: any = {};
    cycle.self = cycle;
    for (const bad of [
      cycle,
      Infinity,
      () => 1,
      Symbol('x'),
      new Date(),
      new Array(5001),
      JSON.parse('{"__proto__":{}}'),
    ])
      expect(() => codeResult(bad)).toThrow();
  });
  it('bounds and validates any JSON-root argument without scope-key injection', () => {
    expect(parseCodeArgs('4')).toBe(4);
    expect(parseCodeArgs('[1,true]')).toEqual([1, true]);
    expect(parseCodeArgs('null')).toBe(null);
    for (const text of [
      'x',
      JSON.stringify('😀'.repeat(17000)),
      '{"__proto__":1}',
      '['.repeat(17) + '0' + ']'.repeat(17),
    ])
      expect(() => parseCodeArgs(text)).toThrow();
  });
  it('refuses serialization of hostile script returns honestly after execution', async () => {
    const s = setup();
    const result = await scriptRunHandler({
      ...s.ctx,
      args: { source: 'return { get hidden() { throw Error("getter ran"); } };' },
    });
    expect(result).toMatchObject({
      error: { code: 'INTERNAL', message: 'Code objects cannot contain accessors' },
    });
  });
});

it('normal native chat returns a canonical UUID, while impostors and stale results fail honestly', async () => {
  const s = setup(false, 'chat');
  class NativeChatMessage {
    _source = { _id: 'message' };
    toJSON() {
      throw Error('must not run');
    }
  }
  const message = new NativeChatMessage();
  (globalThis as any).foundry.documents = { ChatMessage: { implementation: NativeChatMessage } };
  (globalThis as any).game.messages = { get: () => message };
  s.macro.execute.mockResolvedValue(message);
  await admitted(s);
  expect(await macroRunHandler(s.ctx)).toMatchObject({
    structured: { result: '{"uuid":"ChatMessage.message"}' },
  });
  (globalThis as any).game.messages.get = () => undefined;
  expect(await macroRunHandler(s.ctx)).toMatchObject({ error: { code: 'INTERNAL' } });
  expect(() =>
    codeResult({
      _source: { _id: 'message' },
      toJSON() {
        throw Error('must not run');
      },
    }),
  ).toThrow();
});
it('hostile thrown proxies never escape error reporting or expose stacks', async () => {
  const s = setup();
  const result = await scriptRunHandler({
    ...s.ctx,
    args: {
      source:
        'throw new Proxy({}, { getOwnPropertyDescriptor() { throw Error("secret descriptor"); }, getPrototypeOf() { throw Error("secret prototype"); } });',
    },
  });
  expect(result).toEqual({ error: { code: 'INTERNAL', message: 'Code execution failed' } });
});
