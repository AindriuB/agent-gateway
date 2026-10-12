import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1. The suite creates its own temporary GM-owned pf2e
// character (the human approves the create and the delete) and deletes exactly that UUID after.
// Set AGENT_GATEWAY_E2E_PF2E_WRITE=1 as well to exercise the (approved) condition write path.
const enabled = process.env.AGENT_GATEWAY_E2E_PF2E === '1';
const writes = process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

describe.skipIf(!enabled)('pf2e adapter (set AGENT_GATEWAY_E2E_PF2E=1)', () => {
  let session: UserSession;
  let actorUuid: string | undefined;
  beforeAll(async () => {
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    const made = await session.gateway.call('document_create', {
      type: 'Actor',
      data: JSON.stringify({ name: 'agent-gateway e2e pf2e (temporary)', type: 'character' }),
    });
    expect(made.isError, made.text).toBe(false);
    actorUuid = made.structured?.uuid as string;
    expect(typeof actorUuid).toBe('string');
  });
  afterAll(async () => {
    try {
      if (actorUuid) await session.gateway.call('document_delete', { uuids: [actorUuid] });
    } finally {
      await session?.close();
    }
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

  it.skipIf(!writes)(
    'applies frightened 2 via the system condition API and restores it',
    async () => {
      const before = await call('conditions');
      const prior = ((before.structured?.conditions ?? []) as Row[]).find(
        (c) => c.id === 'frightened',
      );
      try {
        const on = await call('conditions', {
          change: { id: 'frightened', active: true, value: 2 },
        });
        expect(on.isError, on.text).toBe(false);
        const rows = (on.structured?.conditions ?? []) as Row[];
        expect(rows.find((c) => c.id === 'frightened')?.value).toBe(2);
      } finally {
        const restore = await call('conditions', {
          change: prior
            ? { id: 'frightened', active: true, value: prior.value as number }
            : { id: 'frightened', active: false },
        });
        expect(restore.isError, restore.text).toBe(false);
        const after = ((restore.structured?.conditions ?? []) as Row[]).find(
          (c) => c.id === 'frightened',
        );
        expect(after?.value).toBe(prior?.value);
      }
    },
  );
});
