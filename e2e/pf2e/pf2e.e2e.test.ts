import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1. The suite creates its own temporary GM-owned pf2e
// character (the human approves the create and the delete) and deletes exactly that UUID after.
// Set AGENT_GATEWAY_E2E_PF2E_WRITE=1 as well to exercise the (approved) condition write path.
const enabled = process.env.AGENT_GATEWAY_E2E_PF2E === '1';
const writes = process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

// Tests that wait on a human's approval must not be bounded by the default 5 s test timeout, nor
// effectively by the human's decision time; the approval itself expires on the gateway side.
const HUMAN_TIMEOUT_MS = 10 * 60_000;

const UUID_RE = /\b(?:Actor\.[A-Za-z0-9]{16}(?:\.Item\.[A-Za-z0-9]{16})?)\b/;

/**
 * A call that needs the human's approval returns pending_approval with an id. Poll the
 * approval_status tool until that is terminal; there is deliberately no wall-clock bound across
 * the human's decision (the test timeout still applies). Returns the final result and, for a
 * pending call, the uuid found in the approved result text.
 */
async function settle(
  session: UserSession,
  r: CallResult,
): Promise<{ result: CallResult; uuid: string | undefined }> {
  let current = r;
  if (r.structured?.status === 'pending_approval') {
    const id = String(r.structured.id);
    for (;;) {
      current = await session.gateway.call('approval_status', { id });
      if (current.isError) throw new Error(`approval_status ${id} failed: ${current.text}`);
      const status = current.structured?.status;
      if (status === 'approved' && typeof current.structured?.result === 'string') break;
      if (status === 'denied' || status === 'expired' || status === 'unknown')
        throw new Error(`approval ${id} ended ${String(status)}: ${current.text}`);
      await new Promise((res) => setTimeout(res, 1000));
    }
    const text = String(current.structured?.result);
    return {
      result: { ...current, isError: current.structured?.resultFailed === true, text },
      uuid: UUID_RE.exec(text)?.[0],
    };
  }
  return {
    result: r,
    uuid: typeof r.structured?.uuid === 'string' ? r.structured.uuid : undefined,
  };
}

// Tests are always registered (so `vitest list` shows them); each skips at run time unless enabled.
describe('pf2e adapter (set AGENT_GATEWAY_E2E_PF2E=1)', () => {
  let session: UserSession;
  let actorUuid: string | undefined;
  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    const made = await settle(
      session,
      await session.gateway.call('document_create', {
        type: 'Actor',
        data: JSON.stringify({ name: 'agent-gateway e2e pf2e (temporary)', type: 'character' }),
      }),
    );
    expect(made.result.isError, made.result.text).toBe(false);
    actorUuid = made.uuid;
    expect(typeof actorUuid).toBe('string');
  }, HUMAN_TIMEOUT_MS);
  afterAll(async () => {
    // A thrown or timed-out settle must not skip session.close(), and residue is named loudly.
    let failure: unknown;
    try {
      if (actorUuid) {
        const del = await settle(
          session,
          await session.gateway.call('document_delete', { uuids: [actorUuid] }),
        );
        if (del.result.isError) throw new Error(del.result.text);
      }
    } catch (e) {
      failure = new Error(
        `RESIDUE: temporary actor ${String(actorUuid)} may still exist: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    try {
      await session?.close();
    } catch (e) {
      failure ??= e;
    }
    if (failure) throw failure;
  }, HUMAN_TIMEOUT_MS);
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

  it(
    'applies frightened 2 via the system condition API and restores it',
    async (ctx) => {
      if (!writes) return ctx.skip();
      const frightened = async () => {
        const r = await call('conditions');
        expect(r.isError, r.text).toBe(false);
        return ((r.structured?.conditions ?? []) as Row[]).find((c) => c.id === 'frightened');
      };
      const prior = await frightened();
      try {
        const on = await settle(
          session,
          await call('conditions', { change: { id: 'frightened', active: true, value: 2 } }),
        );
        expect(on.result.isError, on.result.text).toBe(false);
        expect((await frightened())?.value).toBe(2);
      } finally {
        const restore = await settle(
          session,
          await call('conditions', {
            change: prior
              ? { id: 'frightened', active: true, value: prior.value as number }
              : { id: 'frightened', active: false },
          }),
        );
        expect(restore.result.isError, restore.result.text).toBe(false);
        // Assert against an actual read after the restore has completed.
        expect((await frightened())?.value).toBe(prior?.value);
      }
    },
    HUMAN_TIMEOUT_MS,
  );

  it(
    'performs a strike without a dialog and audits its chat message as created',
    async (ctx) => {
      if (!writes) return ctx.skip();
      const page = session.browser.page;
      const madeWeapon = await settle(
        session,
        await session.gateway.call('document_create', {
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
        }),
      );
      expect(madeWeapon.result.isError, madeWeapon.result.text).toBe(false);
      const weaponUuid = madeWeapon.uuid;
      expect(typeof weaponUuid).toBe('string');
      try {
        // Count CheckModifiersDialog renders (pf2e.mjs:19217) from before the call.
        await page.evaluate(`(() => {
        window.__agentGatewayDialogs = 0;
        window.__agentGatewayDialogHook = Hooks.on('renderCheckModifiersDialog', () => {
          window.__agentGatewayDialogs++;
        });
      })()`);
        const listed = await call('actions_list');
        const strike = ((listed.structured?.actions ?? []) as Row[]).find(
          (a) =>
            a.group === 'Strikes' &&
            String(a.id).startsWith(`strike:${(weaponUuid as string).split('.').pop()}:`) &&
            String(a.id).endsWith(':0'),
        );
        expect(strike, listed.text).toBeDefined();
        const performed = await settle(
          session,
          await call('action_perform', { actionId: strike?.id }),
        );
        expect(performed.result.isError, performed.result.text).toBe(false);
        if (
          performed.result.structured?.status !== 'approved' &&
          performed.result.structured?.completed !== undefined
        )
          expect(performed.result.structured?.completed).toBe(true);
        const found = (await page.evaluate(`(async () => {
        const dialogs = window.__agentGatewayDialogs;
        const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
        const pages = journal ? [...journal.pages] : [];
        const page = pages
          .filter((p) => p.system.tool === 'action_perform' && p.system.args.includes(${JSON.stringify(
            strike?.id,
          )}))
          .sort((a, b) => b.system.timestamp - a.system.timestamp)[0];
        const created = (page?.system.targets ?? []).filter(
          (t) => t.existed === false && t.undoable === true && t.uuid.startsWith('ChatMessage.'),
        );
        return { dialogs, created: created.map((t) => t.uuid) };
      })()`)) as { dialogs: number; created: string[] };
        expect(found.dialogs).toBe(0);
        expect(found.created).toHaveLength(1);
      } finally {
        // Independent of the audit lookup. Deleting the actor does not delete its chat messages.
        await page.evaluate(`(async () => {
        if (window.__agentGatewayDialogHook !== undefined)
          Hooks.off('renderCheckModifiersDialog', window.__agentGatewayDialogHook);
        delete window.__agentGatewayDialogs;
        delete window.__agentGatewayDialogHook;
        const ids = game.messages
          .filter((m) => m.flags?.pf2e?.origin?.uuid === ${JSON.stringify(weaponUuid)} &&
            m.flags?.pf2e?.context?.type === 'attack-roll')
          .map((m) => m.id);
        for (const id of ids) await game.messages.get(id)?.delete();
      })()`);
        // The weapon is embedded in the temporary actor, which the suite deletes.
      }
    },
    HUMAN_TIMEOUT_MS,
  );
});
