import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  defineTool,
  TOOLS,
  toolsForRole,
  parseLinkMessage,
  toJsonSchema,
  type AnnouncedTool,
} from '@agent-gateway/protocol';
import { LINK_AGENT_HEADLESS, installBridge } from '../../src/link/bridge.js';
import { LinkClient } from '../../src/link/client.js';
import {
  ToolsetAnnouncer,
  computeToolset,
  installToolsetAnnouncer,
  policyDenies,
} from '../../src/link/toolset.js';
import type { PolicyInputs } from '../../src/policy/evaluate.js';
import { type ToolInfo } from '../../src/ops/registry.js';
import { createDispatcher } from '../../src/ops/dispatch.js';

const gmNames = TOOLS.filter((t) => t.minRole === 'gm').map((t) => t.name);

describe('computeToolset', () => {
  it('is the role tools, sorted', () => {
    expect(computeToolset(true).map((t) => t.name)).toEqual(
      toolsForRole(true)
        .map((t) => t.name)
        .sort(),
    );
    expect(computeToolset(false).map((t) => t.name)).toEqual(
      toolsForRole(false)
        .map((t) => t.name)
        .sort(),
    );
  });

  it('player tools are a subset of GM tools', () => {
    const gm = new Set(computeToolset(true).map((t) => t.name));
    for (const n of computeToolset(false)) expect(gm.has(n.name)).toBe(true);
  });

  it('drops tools whose category policy denies', () => {
    const all = computeToolset(true);
    const noRead = computeToolset(true, (c) => c === 'read');
    const expected = toolsForRole(true)
      .filter((t) => t.category !== 'read')
      .map((t) => t.name)
      .sort();
    expect(noRead.map((t) => t.name)).toEqual(expected);
    expect(noRead.length).toBeLessThan(all.length);
  });

  it('never lists GM tools for a non-GM, whatever the policy says', () => {
    for (const n of computeToolset(false, () => false)) expect(gmNames).not.toContain(n.name);
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
const info = (t: ReturnType<typeof mk>): ToolInfo => ({
  name: t.name,
  category: t.category,
  minRole: t.minRole,
  description: t.description,
  ...toJsonSchema(t),
  origin: 'core',
});
const pTool = info(mk('p_tool', 'player', 'read'));
const gTool = info(mk('g_tool', 'gm', 'read'));

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
    const sent: { tools: AnnouncedTool[] }[] = [];
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

describe('policyDenies', () => {
  const matrix = (over: Partial<Record<'read' | 'write' | 'destructive' | 'code', string>>) => {
    const cls = {
      read: 'allow',
      write: 'ask_owner',
      destructive: 'ask_gm',
      code: 'ask_owner',
      ...over,
    };
    return { playerAgents: cls, gmAgents: cls } as unknown as PolicyInputs['world'];
  };
  const inputs = (o: Partial<PolicyInputs> = {}): PolicyInputs => ({
    world: matrix({}),
    owner: matrix({}),
    playerAgentsEnabled: true,
    headlessAgentsEnabled: false,
    ...o,
  });

  it('hides only deny; ask_* and allow stay listed', () => {
    const d = policyDenies(
      () => inputs({ world: matrix({ write: 'deny' }) }),
      () => true,
    );
    expect(d('write')).toBe(true);
    expect(d('read')).toBe(false);
    expect(d('destructive')).toBe(false);
    expect(d('code')).toBe(false);
  });

  it('the owner policy can hide a category but never reveal one the world denies', () => {
    const owner = policyDenies(
      () => inputs({ owner: matrix({ read: 'deny' }) }),
      () => true,
    );
    expect(owner('read')).toBe(true);
    const world = policyDenies(
      () => inputs({ world: matrix({ read: 'deny' }), owner: matrix({ read: 'allow' }) }),
      () => true,
    );
    expect(world('read')).toBe(true);
  });

  it('a player with playerAgentsEnabled off gets an empty set; a GM does not', () => {
    const off = inputs({ playerAgentsEnabled: false });
    expect(
      computeToolset(
        false,
        policyDenies(
          () => off,
          () => false,
        ),
      ),
    ).toEqual([]);
    expect(
      computeToolset(
        true,
        policyDenies(
          () => off,
          () => true,
        ),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('judges the class of the live user', () => {
    const w = matrix({});
    w.playerAgents = { ...w.playerAgents, read: 'deny' };
    let gm = false;
    const d = policyDenies(
      () => inputs({ world: w }),
      () => gm,
    );
    expect(d('read')).toBe(true);
    gm = true;
    expect(d('read')).toBe(false);
  });
});

describe('installToolsetAnnouncer on a real client', () => {
  class Sock {
    onopen: ((e?: unknown) => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: ((e?: unknown) => void) | null = null;
    onerror: ((e?: unknown) => void) | null = null;
    readyState = 1;
    sent: { type: string }[] = [];
    send(d: string) {
      this.sent.push(JSON.parse(d));
    }
    close() {}
    recv(m: object) {
      this.onmessage?.({ data: JSON.stringify(m) });
    }
  }
  const mkClient = () => {
    const sock = new Sock();
    const client = new LinkClient({
      getGatewayUrl: () => 'ws://gw',
      getToken: () => JSON.stringify({ url: 'ws://gw', token: 't' }),
      setToken: () => {},
      getIdentity: () => ({
        moduleVersion: '0',
        foundryVersion: '14',
        world: { id: 'w', title: 'W', system: 's', systemVersion: '1' },
        user: { id: 'u', name: 'U', role: 1, isGM: false },
      }),
      createSocket: () => sock,
      notifyError: () => {},
    });
    return { sock, client };
  };
  const welcome = {
    type: 'welcome',
    gatewayVersion: '0',
    protocolVersion: PROTOCOL_VERSION,
    connectionId: 'c',
    agentId: 'a',
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('sends toolset only after welcome, once, and again after a reconnect welcome', async () => {
    const { sock, client } = mkClient();
    installToolsetAnnouncer(client, { isGM: () => false });
    client.start();
    sock.onopen?.();
    await flush();
    expect(sock.sent.map((m) => m.type)).toEqual(['hello']);
    sock.recv(welcome);
    await flush();
    expect(sock.sent.map((m) => m.type)).toEqual(['hello', 'toolset']);
    client.stop();
    client.start();
    sock.onopen?.();
    sock.recv(welcome);
    await flush();
    expect(sock.sent.filter((m) => m.type === 'toolset')).toHaveLength(2);
  });
});

describe('headless', () => {
  it('a headless agent with headlessAgentsEnabled off gets an empty set', () => {
    const base: PolicyInputs = {
      world: {
        playerAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
        gmAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
      },
      owner: {
        playerAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
        gmAgents: { read: 'allow', write: 'allow', destructive: 'allow', code: 'ask_owner' },
      },
      playerAgentsEnabled: true,
      headlessAgentsEnabled: false,
    };
    const set = (headless: boolean) =>
      computeToolset(
        true,
        policyDenies(
          () => base,
          () => true,
          headless,
        ),
      );
    expect(set(true)).toEqual([]);
    expect(set(false).length).toBeGreaterThan(0);
  });

  it('the listing and the bridge use the same headless value', () => {
    expect(LINK_AGENT_HEADLESS).toBe(false);
  });
});

describe('registry definition announcements', () => {
  it('announces core and pack metadata, including schemas and pack provenance', () => {
    const schema = { type: 'object', additionalProperties: false };
    const packInfo: ToolInfo = {
      name: 'demo-fixture',
      category: 'read',
      minRole: 'player',
      description: 'Fixture tool',
      inputSchema: schema,
      outputSchema: schema,
      origin: { packId: 'demo-pack', version: '1.0.0', prefix: 'demo' },
    };
    const announced = computeToolset(
      true,
      () => false,
      () => [pTool, packInfo],
    );
    expect(announced.map((t) => t.name)).toEqual(['demo-fixture', 'p_tool']);
    expect(announced[0]).toMatchObject({
      inputSchema: schema,
      outputSchema: schema,
      pack: { id: 'demo-pack', version: '1.0.0', prefix: 'demo' },
    });
    expect(parseLinkMessage(JSON.stringify({ type: 'toolset', tools: announced })).ok).toBe(true);
  });

  it('refreshes when only a definition schema changes', () => {
    let tool = pTool;
    const send = vi.fn();
    const announcer = new ToolsetAnnouncer({ isGM: () => false, toolsForRole: () => [tool], send });
    announcer.connected();
    announcer.refresh();
    tool = {
      ...tool,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { value: { type: 'string', description: 'Value' } },
      },
    };
    announcer.refresh();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
