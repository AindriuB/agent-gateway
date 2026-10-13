/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_PF2E=1 and AGENT_GATEWAY_E2E_PF2E_WRITE=1 (both). The suite creates
// its own temporary GM-owned pf2e character (the human approves every write) and deletes exactly
// that UUID afterwards. Targets test-world (Foundry v14, pf2e 8.6.0).
const enabled =
  process.env.AGENT_GATEWAY_E2E_PF2E === '1' && process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1';

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
describe('pf2e ChoiceSet answers headless (set AGENT_GATEWAY_E2E_PF2E=1 and _WRITE=1)', () => {
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
        data: JSON.stringify({ name: 'agent-gateway e2e choices (temporary)', type: 'character' }),
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

  it(
    "lists a class entry's choices and embeds it with a full decision map, with no prompt",
    async () => {
      // A render counter in the page: any PickAThingPrompt that opens increments it.
      await session.browser.page.evaluate(`(() => {
        globalThis.__agPromptCount = 0;
        globalThis.__agPromptHook = Hooks.on('renderPickAThingPrompt', () => { globalThis.__agPromptCount++; });
      })()`);
      try {
        const classUuids = (await session.browser.page.evaluate(`(async () => {
          const index = await game.packs.get('pf2e.classes').getIndex();
          return index.map((e) => e.uuid);
        })()`)) as string[];
        expect(classUuids.length).toBeGreaterThan(0);
        // The first class whose choices are all answerable by value.
        let classUuid: string | undefined;
        let choices: Array<Record<string, any>> = [];
        for (const uuid of classUuids.slice(0, 40)) {
          const listed = await session.gateway.call('character_build', { listChoices: uuid });
          expect(listed.isError, listed.text).toBe(false);
          const found = (listed.structured?.choices ?? []) as Array<Record<string, any>>;
          expect(found.length).toBeLessThanOrEqual(64);
          if (found.length > 0 && found.every((c) => !c.unsupported && c.options.length > 0)) {
            classUuid = uuid;
            choices = found;
            break;
          }
        }
        expect(classUuid, 'a class whose choices are all answerable by value').toBeDefined();
        const decisions = choices.map((c) => ({
          flag: c.flag as string,
          itemUuid: c.itemUuid as string,
          value: c.options[0].value as string,
        }));
        const done = await settle(
          session,
          await session.gateway.call('compendium_import', {
            uuid: classUuid,
            actorUuid,
            choices: decisions,
          }),
        );
        expect(done.result.isError, done.result.text).toBe(false);
        const state = (await session.browser.page.evaluate(`(async () => {
          const actor = await fromUuid(${q(actorUuid)});
          const selections = {};
          for (const item of actor.items) Object.assign(selections, item.flags?.pf2e?.rulesSelections ?? {});
          return { prompts: globalThis.__agPromptCount, selections, items: actor.items.size };
        })()`)) as { prompts: number; selections: Record<string, unknown>; items: number };
        expect(state.prompts).toBe(0);
        expect(state.items).toBeGreaterThan(0);
        for (const d of decisions)
          expect(state.selections, `flag ${d.flag}`).toHaveProperty(d.flag);
      } finally {
        await session.browser.page.evaluate(`(() => {
          Hooks.off('renderPickAThingPrompt', globalThis.__agPromptHook);
          delete globalThis.__agPromptCount;
          delete globalThis.__agPromptHook;
        })()`);
      }
    },
    humanTimeout(1),
  );
  it(
    'answers a compendium filter choice with a listed UUID, with no prompt',
    async () => {
      await session.browser.page.evaluate(`(() => {
        globalThis.__agPromptCount = 0;
        globalThis.__agPromptHook = Hooks.on('renderPickAThingPrompt', () => { globalThis.__agPromptCount++; });
      })()`);
      try {
        // Feats whose ChoiceSet queries the compendium (`choices.filter`) for a non-feat, non-heritage
        // type without actor references (anything else is listed as dynamic without an Actor).
        const featUuids = (await session.browser.page.evaluate(`(async () => {
          const index = await game.packs.get('pf2e.feats-srd').getIndex({ fields: ['system.rules'] });
          return index
            .filter((e) => (e.system?.rules ?? []).some((r) => r.key === 'ChoiceSet' && !r.selection &&
              r.choices && !Array.isArray(r.choices) && Array.isArray(r.choices.filter) &&
              typeof r.choices.itemType === 'string' && !['feat', 'heritage'].includes(r.choices.itemType) &&
              !JSON.stringify(r.choices).includes('{actor|')))
            .slice(0, 100)
            .map((e) => e.uuid);
        })()`)) as string[];
        expect(featUuids.length, 'a feat with a filter ChoiceSet').toBeGreaterThan(0);
        let featUuid: string | undefined;
        let choices: Array<Record<string, any>> = [];
        let filterFlag: string | undefined;
        for (const uuid of featUuids) {
          const listed = await session.gateway.call('character_build', { listChoices: uuid });
          expect(listed.isError, listed.text).toBe(false);
          const found = (listed.structured?.choices ?? []) as Array<Record<string, any>>;
          // Every choice answerable by value, and at least one with listed UUID options.
          const filter = found.find(
            (c) =>
              !c.dynamic &&
              c.options.length > 0 &&
              c.options.every((o: Record<string, any>) => /^(Compendium|Item)\./.test(o.value)),
          );
          if (filter && found.every((c) => !c.unsupported && (c.dynamic || c.options.length > 0))) {
            featUuid = uuid;
            choices = found;
            filterFlag = filter.flag;
            break;
          }
        }
        expect(featUuid, 'a filter-choice feat answerable by listed UUIDs').toBeDefined();
        const decisions = choices.map((c) => ({
          flag: c.flag as string,
          itemUuid: c.itemUuid as string,
          value: c.options[0]?.value as string,
        }));
        const done = await settle(
          session,
          await session.gateway.call('compendium_import', {
            uuid: featUuid,
            actorUuid,
            choices: decisions.filter((d) => d.value !== undefined),
          }),
        );
        expect(done.result.isError, done.result.text).toBe(false);
        const state = (await session.browser.page.evaluate(`(async () => {
          const actor = await fromUuid(${q(actorUuid)});
          const selections = {};
          for (const item of actor.items) Object.assign(selections, item.flags?.pf2e?.rulesSelections ?? {});
          return { prompts: globalThis.__agPromptCount, selections };
        })()`)) as { prompts: number; selections: Record<string, unknown> };
        expect(state.prompts).toBe(0);
        const chosen = decisions.find((d) => d.flag === filterFlag)!;
        expect(state.selections[chosen.flag]).toBe(chosen.value);
      } finally {
        await session.browser.page.evaluate(`(() => {
          Hooks.off('renderPickAThingPrompt', globalThis.__agPromptHook);
          delete globalThis.__agPromptCount;
          delete globalThis.__agPromptHook;
        })()`);
      }
    },
    humanTimeout(1),
  );
});
