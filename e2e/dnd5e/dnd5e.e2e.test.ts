import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_DND5E_WORLD to the name of a dnd5e test world that is the one
// currently running. Without it every test skips. It reads an existing GM-owned character: set
// AGENT_GATEWAY_E2E_DND5E_ACTOR to its UUID (Actor.<id>). Nothing is created or deleted.
const world = process.env.AGENT_GATEWAY_E2E_DND5E_WORLD;
const actorUuid = process.env.AGENT_GATEWAY_E2E_DND5E_ACTOR;
const enabled = Boolean(world && actorUuid);
type Row = Record<string, unknown>;

describe(`dnd5e adapter (${enabled ? `world ${world}` : 'skipped: set AGENT_GATEWAY_E2E_DND5E_WORLD and AGENT_GATEWAY_E2E_DND5E_ACTOR'})`, () => {
  let session: UserSession;
  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
  });
  afterAll(async () => {
    await session?.close();
  });
  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });
  const call = (name: string, args: Record<string, unknown> = {}) =>
    session.gateway.call(name, { actorUuid, ...args });

  it('actor_summary reports dnd5e statistics', async () => {
    const r = await call('actor_summary');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.systemId).toBe('dnd5e');
    const keys = ((r.structured?.attributes ?? []) as Row[]).map((a) => a.key);
    for (const k of ['hp', 'ac', 'str', 'speed']) expect(keys).toContain(k);
  });
  it('actions_list groups weapons, spells and features', async () => {
    const r = await call('actions_list');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
    for (const a of (r.structured?.actions ?? []) as Row[])
      expect(String(a.id)).toMatch(/^activity:/);
  });
  it('inventory and conditions are readable', async () => {
    const inv = await call('inventory');
    expect(inv.isError, inv.text).toBe(false);
    expect(inv.structured?.supported).toBe(true);
    const c = await call('conditions');
    expect(c.isError, c.text).toBe(false);
    expect(c.structured?.supported).toBe(true);
  });
});
