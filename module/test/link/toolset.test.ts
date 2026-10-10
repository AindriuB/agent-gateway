import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defineTool, TOOLS, toolsForRole, parseLinkMessage } from '@agent-gateway/protocol';
import { installBridge } from '../../src/link/bridge.js';
import { LinkClient } from '../../src/link/client.js';
import { ToolsetAnnouncer, computeToolset } from '../../src/link/toolset.js';
import { createDispatcher } from '../../src/ops/dispatch.js';

const gmNames = TOOLS.filter((t) => t.minRole === 'gm').map((t) => t.name);

describe('computeToolset', () => {
  it('is the role tools, sorted', () => {
    expect(computeToolset(true)).toEqual(
      toolsForRole(true)
        .map((t) => t.name)
        .sort(),
    );
    expect(computeToolset(false)).toEqual(
      toolsForRole(false)
        .map((t) => t.name)
        .sort(),
    );
  });

  it('player tools are a subset of GM tools', () => {
    const gm = new Set(computeToolset(true));
    for (const n of computeToolset(false)) expect(gm.has(n)).toBe(true);
  });

  it('drops tools whose category policy denies', () => {
    const all = computeToolset(true);
    const noRead = computeToolset(true, (c) => c === 'read');
    const expected = toolsForRole(true)
      .filter((t) => t.category !== 'read')
      .map((t) => t.name)
      .sort();
    expect(noRead).toEqual(expected);
    expect(noRead.length).toBeLessThan(all.length);
  });

  it('never lists GM tools for a non-GM, whatever the policy says', () => {
    for (const n of computeToolset(false, () => false)) expect(gmNames).not.toContain(n);
  });
});

const mk = (name: string, minRole: 'player' | 'gm', category: 'read' | 'write') =>
  defineTool({
    name,
    minRole,
    category,
    handledBy: 'module',
    description: name,
    input: z.object({}),
    output: z.object({}),
  });
const pTool = mk('p_tool', 'player', 'read');
const gTool = mk('g_tool', 'gm', 'read');

describe('ToolsetAnnouncer', () => {
  const setup = () => {
    let isGM = false;
    let deny = false;
    const send = vi.fn();
    const a = new ToolsetAnnouncer({
      isGM: () => isGM,
      isCategoryDenied: (c) => deny && c === 'read',
      toolsForRole: (gm) => (gm ? [pTool, gTool] : [pTool]),
      send,
    });
    return {
      a,
      send,
      setGM: (v: boolean) => (isGM = v),
      setDeny: (v: boolean) => (deny = v),
    };
  };

  it('sends on connect, then only on change', () => {
    const t = setup();
    t.a.connected();
    expect(t.send).toHaveBeenCalledTimes(1);
    t.a.refresh();
    expect(t.send).toHaveBeenCalledTimes(1);
    t.setGM(true);
    t.a.refresh();
    t.a.refresh();
    expect(t.send).toHaveBeenCalledTimes(2);
    t.setDeny(true);
    t.a.refresh();
    expect(t.send).toHaveBeenCalledTimes(3);
    expect(t.send.mock.calls[2]![0].tools).toEqual([]);
  });

  it('does not send before the link is welcomed, and resends in full after a reconnect', () => {
    const t = setup();
    t.setGM(true);
    t.a.refresh();
    expect(t.send).not.toHaveBeenCalled();
    t.a.connected();
    t.a.disconnected();
    t.a.refresh();
    expect(t.send).toHaveBeenCalledTimes(1);
    t.a.connected();
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it('sends frames that parse as link messages', () => {
    const t = setup();
    t.a.connected();
    expect(parseLinkMessage(JSON.stringify(t.send.mock.calls[0]![0])).ok).toBe(true);
  });
});

describe('a forged toolset does not grant anything', () => {
  it('a player is refused a GM tool at dispatch even if the module announced it', async () => {
    const gmTool = defineTool({
      name: 'forged_gm_tool',
      minRole: 'gm',
      category: 'read',
      handledBy: 'module',
      description: 'gm only',
      input: z.object({}),
      output: z.object({}),
    });
    const handler = vi.fn(async () => ({ text: 'ran', structured: {} }));
    const dispatch = createDispatcher({
      tools: [gmTool],
      handlers: { forged_gm_tool: handler },
      stages: [],
    });
    // The (modified) module claims the GM tool in its toolset...
    const sent: { tools: string[] }[] = [];
    new ToolsetAnnouncer({
      isGM: () => true,
      send: (m) => sent.push(m),
    }).connected();
    // ...but the call is judged on game.user, which is a player.
    const client = new LinkClient({
      getGatewayUrl: () => 'ws://gw',
      getToken: () => null,
      setToken: () => {},
      getIdentity: () => {
        throw new Error('unused');
      },
      createSocket: () => {
        throw new Error('unused');
      },
      notifyError: () => {},
    });
    installBridge(client, {
      dispatch,
      getUser: () => ({ id: 'p1', isGM: false }),
    });
    const res = await client.onCall!({
      type: 'call',
      id: '1',
      sessionId: 's',
      tool: 'forged_gm_tool',
      args: {},
    });
    expect(res).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(handler).not.toHaveBeenCalled();
  });
});
