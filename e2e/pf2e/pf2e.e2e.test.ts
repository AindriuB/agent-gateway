import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E_ACTOR to the UUID of a world pf2e character the GM owns.
// Set AGENT_GATEWAY_E2E_PF2E_WRITE=1 as well to exercise the (approved) condition write path.
const actorUuid = process.env.AGENT_GATEWAY_E2E_PF2E_ACTOR;
const writes = process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

describe.skipIf(!actorUuid)('pf2e adapter (set AGENT_GATEWAY_E2E_PF2E_ACTOR)', () => {
  let session: UserSession;
  beforeAll(async () => {
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
  });
  afterAll(async () => {
    await session?.close();
  });
  const call = (name: string, args: Record<string, unknown> = {}) =>
    session.gateway.call(name, { actorUuid, ...args });

  it('actor_summary reports the pf2e statistics', async () => {
    const r = await call('actor_summary');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.systemId).toBe('pf2e');
    const keys = ((r.structured?.attributes ?? []) as Row[]).map((a) => a.key);
    for (const k of ['hp', 'ac', 'level', 'fortitude', 'reflex', 'will', 'perception', 'speed'])
      expect(keys).toContain(k);
  });

  it('actions_list covers strikes with MAP variants and costed actions', async () => {
    const r = await call('actions_list');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
    const actions = (r.structured?.actions ?? []) as Row[];
    expect(actions.some((a) => a.group === 'Strikes')).toBe(true);
    for (const a of actions.filter((x) => x.group === 'Actions'))
      expect(typeof a.cost).toBe('string');
  });

  it('inventory reports bulk totals and item state', async () => {
    const r = await call('inventory');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
    const totals = ((r.structured?.totals ?? []) as Row[]).map((t) => t.key);
    expect(totals).toContain('bulk');
    for (const i of (r.structured?.items ?? []) as Row[]) expect(typeof i.equipped).toBe('boolean');
  });

  it('conditions are readable', async () => {
    const r = await call('conditions');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
  });

  it.skipIf(!writes)('applies and clears frightened 2 via the system condition API', async () => {
    const on = await call('conditions', { change: { id: 'frightened', active: true, value: 2 } });
    expect(on.isError, on.text).toBe(false);
    const rows = (on.structured?.conditions ?? []) as Row[];
    expect(rows.find((c) => c.id === 'frightened')?.value).toBe(2);
    const off = await call('conditions', { change: { id: 'frightened', active: false } });
    expect(off.isError, off.text).toBe(false);
    expect(((off.structured?.conditions ?? []) as Row[]).some((c) => c.id === 'frightened')).toBe(
      false,
    );
  });
});
