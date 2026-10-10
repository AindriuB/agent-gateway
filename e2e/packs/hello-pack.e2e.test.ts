import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

const mode = process.env.AGENT_GATEWAY_E2E_HELLO_PACK;
const enabled = mode === '1' || mode === 'disabled';

describe.skipIf(!enabled)('Hello Pack (set AGENT_GATEWAY_E2E_HELLO_PACK=1 or disabled)', () => {
  let session: UserSession;
  beforeAll(async () => {
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.playerUser);
  });
  afterAll(async () => {
    await session?.close();
  });
  it('announces enabled pack tools with provenance, or removes disabled tools after relaunch', async () => {
    const listed = await session.gateway.listToolsRaw();
    const tools = listed.tools.filter((t) => t.name.startsWith('hello-'));
    if (mode === 'disabled') {
      expect(tools).toEqual([]);
      return;
    }
    expect(tools.map((t) => t.name).sort()).toEqual(['hello-dice_odds', 'hello-journal_stamp']);
    for (const tool of tools)
      expect((tool as { description?: string }).description).toContain(
        '[Third-party tool pack hello: agent-gateway-hello-pack 0.1.0]',
      );
    const result = await session.gateway.call('hello-dice_odds', { count: 2, sides: 6, target: 7 });
    expect(result.isError, result.text).toBe(false);
    expect(result.structured?.probability).toBeCloseTo(21 / 36, 6);
  });
});
