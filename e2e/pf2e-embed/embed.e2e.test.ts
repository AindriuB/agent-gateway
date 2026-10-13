import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1 and AGENT_GATEWAY_E2E_PF2E_WRITE=1 (both). The suite creates
// its own temporary GM-owned pf2e character (the human approves every write) and deletes exactly
// that UUID afterwards. Targets test-world (Foundry v14, pf2e 8.6.0).
const enabled =
  process.env.AGENT_GATEWAY_E2E_PF2E === '1' && process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

// A pending approval expires on the gateway after its TTL (module/src/approvals/config.ts,
// APPROVAL_TTL_MS, mirrored here), so a human's answer can arrive any time up to then. Each test
// that waits on N sequential approvals gets N TTLs plus margin, so the vitest timeout (not an
// early give-up) is what bounds the wait and an approval can never land after the test stopped.
const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;

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

const q = (v: unknown): string => JSON.stringify(v);

// Tests are always registered (so `vitest list` shows them); each skips at run time unless enabled.
describe('pf2e compendium_import into an Actor (set AGENT_GATEWAY_E2E_PF2E=1 and _WRITE=1)', () => {
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
        data: JSON.stringify({ name: 'agent-gateway e2e embed (temporary)', type: 'character' }),
      }),
    );
    expect(made.result.isError, made.result.text).toBe(false);
    actorUuid = made.uuid;
    expect(typeof actorUuid).toBe('string');
  }, humanTimeout(1));
  afterAll(async () => {
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
  }, humanTimeout(1));
  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });

  /** The audit page for this actor and created Item (older runs' pages are ignored), polled for up to 10 s; its created Item targets. */
  const auditedItems = async (compendiumUuid: string, createdUuid: string): Promise<Array<Row>> =>
    (await session.browser.page.evaluate(`(async () => {
      const find = () => {
        const journal = game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'));
        return [...(journal?.pages ?? [])]
          .filter((p) => p.system.tool === 'compendium_import' && p.system.args.includes(${q(compendiumUuid)}) &&
            p.system.args.includes(${q(actorUuid)}) &&
            (p.system.targets ?? []).some((t) => t.uuid === ${q(createdUuid)}))
          .sort((a, b) => b.system.timestamp - a.system.timestamp)[0];
      };
      let page = find();
      for (let i = 0; i < 40 && !page; i++) {
        await new Promise((r) => setTimeout(r, 250));
        page = find();
      }
      return (page?.system.targets ?? []).filter((t) => t.uuid.startsWith(${q(actorUuid + '.Item.')}));
    })()`)) as Row[];

  const embed = async (uuid: string, overrides: Record<string, unknown>) => {
    const done = await settle(
      session,
      await session.gateway.call('compendium_import', { uuid, actorUuid, overrides }),
    );
    expect(done.result.isError, done.result.text).toBe(false);
    expect(done.uuid, done.result.text).toBeDefined();
    const read = await session.gateway.call('document_get', { uuid: done.uuid });
    expect(read.isError, read.text).toBe(false);
    return done.uuid as string;
  };
  const itemState = async (uuid: string) =>
    (await session.browser.page.evaluate(`(async () => {
      const i = await fromUuid(${q(uuid)});
      return { type: i?.type, quantity: i?.system.quantity, carryType: i?.system.equipped?.carryType,
        handsHeld: i?.system.equipped?.handsHeld, location: i?.system.location };
    })()`)) as Row;

  it(
    'embeds a weapon with quantity and equipped, audited as created',
    async () => {
      const found = await session.gateway.call('compendium_search', {
        query: 'Dagger',
        pack: 'pf2e.equipment-srd',
        limit: 50,
      });
      const hit = ((found.structured?.results ?? []) as Row[]).find(
        (r) => r.name === 'Dagger' && r.type === 'weapon',
      );
      expect(hit, found.text).toBeDefined();
      const weaponUuid = await embed(hit?.uuid as string, { quantity: 2, equipped: true });
      expect(await itemState(weaponUuid)).toMatchObject({
        type: 'weapon',
        quantity: 2,
        carryType: 'held',
        handsHeld: 1,
      });
      const targets = await auditedItems(hit?.uuid as string, weaponUuid);
      expect(targets.map((t) => t.uuid)).toContain(weaponUuid);
      for (const t of targets) expect(t).toMatchObject({ existed: false, undoable: true });
    },
    humanTimeout(1),
  );

  it(
    'embeds a feat into a free slot, audited as created',
    async () => {
      // A level-1 ancestry feat with no ChoiceSet or grants, found in the browser's pack index.
      const featUuid = (await session.browser.page.evaluate(`(async () => {
        const pack = game.packs.get('pf2e.feats-srd');
        const index = await pack.getIndex({ fields: ['system.category', 'system.level.value', 'system.rules'] });
        const hit = index.find((e) => e.system?.category === 'ancestry' && e.system?.level?.value === 1 &&
          !(e.system.rules ?? []).some((r) => /ChoiceSet|GrantItem/.test(r.key)));
        return hit?.uuid ?? null;
      })()`)) as string | null;
      expect(featUuid).not.toBeNull();
      // A bare character has no feat slots: pf2e derives them from its class (CharacterFeats takes
      // `class.grantedFeatSlots`, pf2e.mjs:35015). Give it a minimal custom class, then use a slot
      // that exists and is open instead of hard-coding one.
      const madeClass = await settle(
        session,
        await session.gateway.call('document_create', {
          type: 'Item',
          parentUuid: actorUuid,
          data: JSON.stringify({ name: 'agent-gateway e2e class (temporary)', type: 'class' }),
        }),
      );
      expect(madeClass.result.isError, madeClass.result.text).toBe(false);
      const slotId = (await session.browser.page.evaluate(`(async () => {
        const actor = await fromUuid(${q(actorUuid)});
        const group = actor.feats.get('ancestry');
        return Object.values(group?.slots ?? {}).find((s) => !s.feat)?.id ?? null;
      })()`)) as string | null;
      expect(slotId, 'the class should grant an open ancestry feat slot').not.toBeNull();
      const created = await embed(featUuid as string, { slot: slotId });
      expect(await itemState(created)).toMatchObject({ type: 'feat', location: slotId });
      const targets = await auditedItems(featUuid as string, created);
      expect(targets.map((t) => t.uuid)).toContain(created);
      for (const t of targets) expect(t).toMatchObject({ existed: false, undoable: true });
    },
    humanTimeout(1),
  );
});
