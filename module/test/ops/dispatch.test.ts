import { defineTool } from '@agent-gateway/protocol';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createDispatcher, dispatch } from '../../src/ops/dispatch.js';
import type { Stage } from '../../src/ops/stages.js';
import type { OpCall, OpContext } from '../../src/ops/types.js';

const mk = (name: string, minRole: 'player' | 'gm') =>
  defineTool({
    name,
    minRole,
    category: 'read',
    handledBy: 'module',
    description: 'x',
    input: z.strictObject({ id: z.string(), n: z.number().optional() }),
    output: z.strictObject({}),
  });

const tools = [mk('read_thing', 'player'), mk('gm_thing', 'gm')];
const agent = { id: 'a1', ownerUserId: 'u1', headless: false };
const call = (tool: string, args: unknown = { id: 'x' }): OpCall => ({
  tool,
  args,
  agent,
  sessionId: 's1',
});
const player = { id: 'u1', isGM: false };
const gm = { id: 'u2', isGM: true };
const ok = { text: 'hi', structured: { a: 1 } };

describe('dispatch', () => {
  const handler = vi.fn<(ctx: OpContext) => Promise<typeof ok>>(async () => ok);
  const d = createDispatcher({
    tools,
    handlers: { read_thing: handler, gm_thing: handler },
    stages: [],
  });

  it('TOOL_NOT_FOUND', async () => {
    expect(await d(call('nope'), gm)).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
    expect(await d(call('toString'), gm)).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
  });
  it('FORBIDDEN for gm tool and non-GM', async () => {
    expect(await d(call('gm_thing'), player)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await d(call('gm_thing'), gm)).toEqual(ok);
  });
  it('INVALID_ARGS in one line', async () => {
    const r = await d(call('read_thing', { n: 'x', extra: 1 }), player);
    expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect('error' in r && r.error.message).not.toMatch(/\n/);
    expect('error' in r && r.error.message).toMatch(/id/);
  });
  it('passes context and returns the handler result', async () => {
    expect(await d(call('read_thing'), player)).toEqual(ok);
    expect(handler).toHaveBeenLastCalledWith({
      user: player,
      agent,
      sessionId: 's1',
      tool: 'read_thing',
      args: { id: 'x' },
    });
  });
  it('handler throws become INTERNAL without stack', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = createDispatcher({
      tools,
      handlers: {
        read_thing: () => {
          throw new Error('secret boom');
        },
      },
      stages: [],
    });
    const r = await bad(call('read_thing'), gm);
    expect(r).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(JSON.stringify(r)).not.toMatch(/secret|at |\.ts/);
  });
  it('default dispatch has no tools yet', async () => {
    expect(await dispatch(call('read_thing'), gm)).toMatchObject({
      error: { code: 'TOOL_NOT_FOUND' },
    });
  });
});

describe('stages', () => {
  const order: string[] = [];
  const stage = (name: string, o: number, block = false): Stage => ({
    name,
    order: o,
    async run(_ctx, next) {
      order.push(name);
      if (block) return { error: { code: 'DENIED', message: name } };
      return next();
    },
  });
  const handler = vi.fn(async () => {
    order.push('handler');
    return ok;
  });

  it('runs sorted by order regardless of list position', async () => {
    order.length = 0;
    const d = createDispatcher({
      tools,
      handlers: { read_thing: handler },
      stages: [stage('audit', 50), stage('agent-control', 10), stage('policy', 20)],
    });
    expect(await d(call('read_thing'), gm)).toEqual(ok);
    expect(order).toEqual(['agent-control', 'policy', 'audit', 'handler']);
  });
  it('short-circuits', async () => {
    order.length = 0;
    const d = createDispatcher({
      tools,
      handlers: { read_thing: handler },
      stages: [stage('audit', 50), stage('policy', 20, true)],
    });
    expect(await d(call('read_thing'), gm)).toMatchObject({ error: { code: 'DENIED' } });
    expect(order).toEqual(['policy']);
  });
});
