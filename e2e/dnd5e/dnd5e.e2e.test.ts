import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_DND5E_WORLD=dnd5e-test (the dnd5e world that is currently running;
// Foundry 14, dnd5e 6.0.6). Without it every test skips. The suite creates its own temporary
// GM-owned character (the human approves every write), builds it from SRD compendium entries
// (dnd5e.classes, dnd5e.equipment24, dnd5e.spells) and deletes exactly that UUID afterwards.
const world = process.env.AGENT_GATEWAY_E2E_DND5E_WORLD;
const enabled = Boolean(world);
const SKIP = 'skipped: set AGENT_GATEWAY_E2E_DND5E_WORLD (for example dnd5e-test)';

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

describe(`dnd5e adapter (${enabled ? `world ${world}` : SKIP})`, () => {
  let session: UserSession;
  let actorUuid: string | undefined;
  const uuids: Record<string, string> = {};
  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    const made = await settle(
      session,
      await session.gateway.call('document_create', {
        type: 'Actor',
        data: JSON.stringify({ name: 'agent-gateway e2e dnd5e (temporary)', type: 'character' }),
      }),
    );
    expect(made.result.isError, made.result.text).toBe(false);
    actorUuid = made.uuid;
    expect(typeof actorUuid).toBe('string');
  }, humanTimeout(1));
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
  }, humanTimeout(1));
  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });
  const call = (name: string, args: Record<string, unknown> = {}) =>
    session.gateway.call(name, { actorUuid, ...args });
  const find = async (pack: string, name: string): Promise<string> => {
    const r = await session.gateway.call('compendium_search', { query: name, pack, limit: 20 });
    expect(r.isError, r.text).toBe(false);
    const hit = ((r.structured?.results ?? []) as Row[]).find((x) => x.name === name);
    expect(hit, `${name} not found in ${pack}`).toBeDefined();
    return String(hit!.uuid);
  };
  const embed = async (key: string, pack: string, name: string, overrides?: Row) => {
    const done = await settle(
      session,
      await session.gateway.call('compendium_import', {
        uuid: await find(pack, name),
        actorUuid,
        ...(overrides ? { overrides } : {}),
      }),
    );
    expect(done.result.isError, done.result.text).toBe(false);
    expect(done.uuid, done.result.text).toBeDefined();
    uuids[key] = done.uuid as string;
  };

  it(
    'builds the temporary character with compendium_import and character_build',
    async () => {
      await embed('class', 'dnd5e.classes', 'Fighter');
      await embed('sword', 'dnd5e.equipment24', 'Longsword', { equipped: true });
      await embed('cantrip', 'dnd5e.spells', 'Fire Bolt');
      const set = await settle(
        session,
        await call('character_build', {
          changes: [
            { kind: 'skill_rank', skill: 'ath', rank: 1 },
            { kind: 'skill_rank', skill: 'acr', rank: 2 },
          ],
        }),
      );
      expect(set.result.isError, set.result.text).toBe(false);
      const read = await call('character_build');
      expect(read.isError, read.text).toBe(false);
      const skills = (read.structured?.skills ?? []) as Row[];
      expect(skills.find((s) => s.skill === 'ath')?.rank).toBe(1);
      expect(skills.find((s) => s.skill === 'acr')?.rank).toBe(2);
      // The attribute interface does not fit dnd5e: refused, nothing written.
      const refused = await call('character_build', {
        changes: [{ kind: 'attribute_boost', source: 'level', level: 1, attribute: 'str' }],
      });
      expect((await settle(session, refused)).result.isError).toBe(true);
    },
    humanTimeout(5),
  );

  it('actor_summary reports dnd5e statistics', async () => {
    const r = await call('actor_summary');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.systemId).toBe('dnd5e');
    const keys = ((r.structured?.attributes ?? []) as Row[]).map((a) => a.key);
    for (const k of ['hp', 'ac', 'level', 'prof', 'str', 'dex', 'speed']) expect(keys).toContain(k);
  });

  it('actions_list covers the equipped weapon and the cantrip', async () => {
    const r = await call('actions_list');
    expect(r.isError, r.text).toBe(false);
    expect(r.structured?.supported).toBe(true);
    const actions = (r.structured?.actions ?? []) as Row[];
    expect(actions.some((a) => a.group === 'Weapon attacks' && /^attack:/.test(String(a.id)))).toBe(
      true,
    );
    expect(actions.some((a) => a.group === 'Cantrips')).toBe(true);
    for (const a of actions) expect(String(a.id)).toMatch(/^(use|attack|damage):/);
  });

  it('inventory reports the weapon as equipped', async () => {
    const r = await call('inventory');
    expect(r.isError, r.text).toBe(false);
    const items = (r.structured?.items ?? []) as Row[];
    expect(items.find((i) => i.name === 'Longsword')?.equipped).toBe(true);
  });

  it(
    'action_perform rolls the weapon attack and damage through the system API',
    async () => {
      const list = await call('actions_list');
      const ids = ((list.structured?.actions ?? []) as Row[]).map((a) => String(a.id));
      for (const prefix of ['attack:', 'damage:']) {
        const actionId = ids.find(
          (id) => id.startsWith(prefix) && id.includes(uuids.sword!.split('.').pop()!),
        );
        expect(actionId, `no ${prefix} action for the longsword`).toBeDefined();
        const done = await settle(session, await call('action_perform', { actionId }));
        expect(done.result.isError, done.result.text).toBe(false);
      }
    },
    humanTimeout(2),
  );

  it(
    'conditions toggle through toggleStatusEffect and leveled ones by level',
    async () => {
      const on = await settle(
        session,
        await call('conditions', { change: { id: 'poisoned', active: true } }),
      );
      expect(on.result.isError, on.result.text).toBe(false);
      const read = await call('conditions');
      expect(((read.structured?.conditions ?? []) as Row[]).map((c) => c.id)).toContain('poisoned');
      const off = await settle(
        session,
        await call('conditions', { change: { id: 'poisoned', active: false } }),
      );
      expect(off.result.isError, off.result.text).toBe(false);
      const after = await call('conditions');
      expect(((after.structured?.conditions ?? []) as Row[]).map((c) => c.id)).not.toContain(
        'poisoned',
      );
    },
    humanTimeout(2),
  );

  it('the evaluated browser state agrees on the class Item', async () => {
    const state = (await session.browser.page.evaluate(`(async () => {
      const i = await fromUuid(${q(uuids.class)});
      return { type: i?.type, levels: i?.system.levels };
    })()`)) as Row;
    expect(state.type).toBe('class');
  });
});
