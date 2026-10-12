import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1. The suite creates its own temporary GM-owned pf2e
// character (the human approves the create and the delete) and deletes exactly that UUID after.
// Set AGENT_GATEWAY_E2E_PF2E_WRITE=1 as well to exercise the (approved) condition write path.
const enabled = process.env.AGENT_GATEWAY_E2E_PF2E === '1';
const writes = process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

// Tests are always registered (so `vitest list` shows them); each skips at run time unless enabled.
describe('pf2e adapter (set AGENT_GATEWAY_E2E_PF2E=1)', () => {
  let session: UserSession;
  let actorUuid: string | undefined;
  beforeAll(async () => {
    if (!enabled) return;
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
      if (actorUuid) {
        const del = await session.gateway.call('document_delete', { uuids: [actorUuid] });
        expect(del.isError, del.text).toBe(false);
      }
    } finally {
      await session?.close();
    }
  });
  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
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

  it('applies frightened 2 via the system condition API and restores it', async (ctx) => {
    if (!writes) return ctx.skip();
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
  });

  it('performs a strike without a dialog and audits its chat message as created', async (ctx) => {
    if (!writes) return ctx.skip();
    const page = session.browser.page;
    const weapon = await session.gateway.call('document_create', {
      type: 'Item',
      parentUuid: actorUuid,
      data: JSON.stringify({
        name: 'agent-gateway e2e club (temporary)',
        type: 'weapon',
        system: {
          category: 'simple',
          group: 'club',
          damage: { dice: 1, die: 'd6', damageType: 'bludgeoning' },
          equipped: { carryType: 'held', handsHeld: 1 },
        },
      }),
    });
    expect(weapon.isError, weapon.text).toBe(false);
    let messageId: string | undefined;
    try {
      const listed = await call('actions_list');
      const strike = ((listed.structured?.actions ?? []) as Row[]).find(
        (a) =>
          a.group === 'Strikes' &&
          String(a.id).startsWith(
            `strike:${(weapon.structured?.uuid as string).split('.').pop()}:`,
          ) &&
          String(a.id).endsWith(':0'),
      );
      expect(strike, listed.text).toBeDefined();
      const started = Date.now();
      const r = await call('action_perform', { actionId: strike?.id });
      expect(r.isError, r.text).toBe(false);
      expect(r.structured?.completed).toBe(true);
      // A blocked check dialog would hold the call open until its timeout.
      expect(Date.now() - started).toBeLessThan(15_000);
      const found = (await page.evaluate(`(async () => {
        const dialogs = document.querySelectorAll('[class*="check-modifiers"]').length;
        const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
        const pages = journal ? [...journal.pages] : [];
        const page = pages
          .filter((p) => p.system.tool === 'action_perform' && p.system.args.includes(${JSON.stringify(
            strike?.id,
          )}))
          .sort((a, b) => b.system.timestamp - a.system.timestamp)[0];
        const created = (page?.system.targets ?? []).filter(
          (t) => t.existed === false && t.uuid.startsWith('ChatMessage.'),
        );
        return { dialogs, created: created.map((t) => t.uuid) };
      })()`)) as { dialogs: number; created: string[] };
      expect(found.dialogs).toBe(0);
      expect(found.created).toHaveLength(1);
      messageId = found.created[0]?.split('.').pop();
    } finally {
      if (messageId)
        await page.evaluate(`game.messages.get(${JSON.stringify(messageId)})?.delete()`);
      // The weapon is embedded in the temporary actor, which the suite deletes.
    }
  });
});
