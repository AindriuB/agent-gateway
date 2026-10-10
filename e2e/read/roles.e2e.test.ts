import { afterAll, describe, expect, it } from 'vitest';
import { TOOLS } from '@agent-gateway/protocol/tools';
import { toolListProblems, worldInfoProblems } from '../lib/expect.js';
import { loadContext, PlayerCaller } from '../lib/context.js';
import { recordRunData } from '../lib/rundata.js';
import { openUserSession, type UserSession } from '../lib/session.js';

const ctx = loadContext();
const sessions: UserSession[] = [];

afterAll(async () => {
  for (const s of sessions) await s.close();
});

// One session at a time: a gateway is one MCP session and one link port.
async function inSession<T>(user: string, fn: (s: UserSession) => Promise<T>): Promise<T> {
  const s = await openUserSession(ctx.config, ctx.paths, user);
  sessions.push(s);
  try {
    return await fn(s);
  } finally {
    await s.close();
    sessions.splice(sessions.indexOf(s), 1);
  }
}

describe('roles', () => {
  it('world_info reports the world, the system, and each role', async () => {
    for (const [role, user] of [
      ['gm', ctx.config.gmUser],
      ['player', ctx.config.playerUser],
    ] as const) {
      const info = await inSession(user, async (s) => {
        recordRunData(ctx.paths.runData, { kind: 'foundry', version: s.foundryVersion });
        if (role === 'player') {
          const pc = new PlayerCaller(s.gateway, ctx.paths, ctx.fixtures);
          const r = await pc.call('world_info');
          pc.record();
          return r.structured ?? {};
        }
        return (await s.gateway.call('world_info')).structured ?? {};
      });
      expect(worldInfoProblems(role, info, { world: ctx.config.world, user }), role).toEqual([]);
    }
  });

  it("tools/list: the player's tools are a subset of the GM's and include no GM-only tool", async () => {
    const gm = await inSession(ctx.config.gmUser, (s) => s.gateway.listTools());
    const player = await inSession(ctx.config.playerUser, async (s) => {
      const pc = new PlayerCaller(s.gateway, ctx.paths, ctx.fixtures);
      const raw = await s.gateway.listToolsRaw();
      pc.leak.check('tools/list', {}, raw);
      pc.record();
      return raw.tools.map((t) => t.name);
    });
    recordRunData(ctx.paths.runData, { kind: 'tools', role: 'gm', names: gm });
    recordRunData(ctx.paths.runData, { kind: 'tools', role: 'player', names: player });
    const gmOnly = TOOLS.filter((t) => t.minRole === 'gm').map((t) => t.name);
    expect(toolListProblems(player, gm, gmOnly)).toEqual([]);
  });
});
