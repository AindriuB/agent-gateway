import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1 and AGENT_GATEWAY_E2E_PF2E_WRITE=1 (both). Targets
// test-world (Foundry v14, pf2e 8.6.0). The suite creates its own temporary GM-owned level-7
// character and deletes exactly that UUID in afterAll. Every write needs the human's approval.
const enabled =
  process.env.AGENT_GATEWAY_E2E_PF2E === '1' && process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

type Row = Record<string, unknown>;

// Mirrors module/src/approvals/config.ts APPROVAL_TTL_MS; see e2e/pf2e/pf2e.e2e.test.ts.
const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;
const UUID_RE = /\b(?:Actor\.[A-Za-z0-9]{16}(?:\.Item\.[A-Za-z0-9]{16})?)\b/;

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

const ALL = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const slots = () => ({
  0: { value: ['str', 'dex'], selected: null },
  1: { value: ALL, selected: null },
});

// Tests are always registered (so `vitest list` shows them); each skips at run time unless enabled.
describe('pf2e character_build (set AGENT_GATEWAY_E2E_PF2E=1 and AGENT_GATEWAY_E2E_PF2E_WRITE=1)', () => {
  let session: UserSession;
  let actorUuid: string | undefined;
  let featUuid: string | undefined;

  const create = async (type: string, data: Row, parentUuid?: string) => {
    const made = await settle(
      session,
      await session.gateway.call('document_create', {
        type,
        ...(parentUuid ? { parentUuid } : {}),
        data: JSON.stringify(data),
      }),
    );
    expect(made.result.isError, made.result.text).toBe(false);
    expect(typeof made.uuid).toBe('string');
    return made.uuid!;
  };

  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    actorUuid = await create('Actor', {
      name: 'agent-gateway e2e build (temporary)',
      type: 'character',
      system: { details: { level: { value: 7 } } },
    });
    await create(
      'Item',
      { name: 'e2e ancestry (temporary)', type: 'ancestry', system: { boosts: slots() } },
      actorUuid,
    );
    await create(
      'Item',
      { name: 'e2e background (temporary)', type: 'background', system: { boosts: slots() } },
      actorUuid,
    );
    await create(
      'Item',
      {
        name: 'e2e class (temporary)',
        type: 'class',
        system: { keyAbility: { value: ['str', 'dex'], selected: null } },
      },
      actorUuid,
    );
    featUuid = await create(
      'Item',
      {
        name: 'e2e feat (temporary)',
        type: 'feat',
        system: { category: 'class', level: { value: 1 } },
      },
      actorUuid,
    );
  }, humanTimeout(6));

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

  const call = (name: string, args: Record<string, unknown> = {}) =>
    session.gateway.call(name, { actorUuid, ...args });

  it('describes the unbuilt character', async () => {
    const r = await call('character_build');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
    expect(r.structured?.systemId).toBe('pf2e');
  });

  it(
    'applies ancestry, background, class, level boosts, a skill rank and a feat slot in one call',
    async () => {
      const before = await call('character_build');
      const open = ((before.structured?.featSlots ?? []) as Row[]).find((s) => !s.itemUuid);
      expect(open, 'the character has an open feat slot').toBeDefined();
      const changes = [
        { kind: 'attribute_boost', source: 'ancestry', slot: '0', attribute: 'str' },
        { kind: 'attribute_boost', source: 'background', slot: '1', attribute: 'con' },
        { kind: 'key_attribute', attribute: 'str' },
        { kind: 'attribute_boost', source: 'level', level: 1, attribute: 'dex' },
        { kind: 'attribute_boost', source: 'level', level: 5, attribute: 'wis' },
        { kind: 'skill_rank', skill: 'athletics', rank: 2 },
        { kind: 'feat_slot', slot: open!.slot, itemUuid: featUuid },
      ];
      const applied = await settle(session, await call('character_build', { changes }));
      expect(applied.result.isError, applied.result.text).toBe(false);

      const state = await call('character_build');
      const s = state.structured as Row;
      const boosts = s.boosts as Row[];
      const has = (o: Row) => boosts.some((b) => Object.entries(o).every(([k, v]) => b[k] === v));
      expect(has({ source: 'ancestry', slot: '0', attribute: 'str' })).toBe(true);
      expect(has({ source: 'background', slot: '1', attribute: 'con' })).toBe(true);
      expect(has({ source: 'level', level: 1, attribute: 'dex' })).toBe(true);
      expect(has({ source: 'level', level: 5, attribute: 'wis' })).toBe(true);
      expect((s.keyAttribute as Row).selected).toBe('str');
      expect(((s.skills as Row[]).find((k) => k.skill === 'athletics') ?? {}).rank).toBe(2);
      expect(((s.featSlots as Row[]).find((f) => f.slot === open!.slot) ?? {}).itemUuid).toBe(
        featUuid,
      );

      const summary = await call('actor_summary');
      expect(summary.isError, summary.text).toBe(false);
      expect(summary.structured?.systemId).toBe('pf2e');
    },
    humanTimeout(1),
  );
});
