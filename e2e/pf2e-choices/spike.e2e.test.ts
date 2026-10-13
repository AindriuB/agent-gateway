import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Task 49 spike (design gate, "Spike first"). NOT part of the normal run; needs Andrew's per-run
// approval. Opt-in: AGENT_GATEWAY_E2E_PF2E=1 and AGENT_GATEWAY_E2E_PF2E_WRITE=1 (both), plus
// AGENT_GATEWAY_E2E_PF2E_SPIKE=1.
//
// Question: does the custom native create option `operation.agentGateway.callId` reach
// `ChoiceSet.prototype.preCreate` for (1) a top-level item, (2) class `system.items` grants,
// (3) GrantItem children?
//
// Writes (GM browser page, no gateway tool, so no approval dialog): ONE temporary character
// actor, and on it up to three synthetic parent items (a feat with a ChoiceSet rule, a class
// whose system.items grants a real compendium feat that has a ChoiceSet, a feat with a
// GrantItem rule to that same feat). The probe replaces ChoiceSet.prototype.preCreate for the
// duration, records `callId` presence per call, marks the rule ignored and NEVER calls the
// original, so no PickAThingPrompt can open (a renderPickAThingPrompt counter must stay 0).
// Cleanup (finally): restore the original preCreate (identity checked), remove the hook, delete
// the actor by exact UUID, then verify it is gone.
const enabled =
  process.env.AGENT_GATEWAY_E2E_PF2E === '1' &&
  process.env.AGENT_GATEWAY_E2E_PF2E_WRITE === '1' &&
  process.env.AGENT_GATEWAY_E2E_PF2E_SPIKE === '1';

describe('task 49 spike: callId reaches ChoiceSet.preCreate (AGENT_GATEWAY_E2E_PF2E_SPIKE=1)', () => {
  let session: UserSession;
  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    session = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
  }, 240_000);
  afterAll(async () => {
    await session?.close();
  });
  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });

  it('reports, per layer, whether the callId arrives', async () => {
    const result = (await session.browser.page.evaluate(`(async () => {
      const CS = game.pf2e?.RuleElements?.builtin?.ChoiceSet;
      if (!CS || typeof CS.prototype.preCreate !== 'function') return { fatal: 'ChoiceSet.preCreate missing' };
      const original = CS.prototype.preCreate;
      const calls = [];
      let prompts = 0;
      const hookId = Hooks.on('renderPickAThingPrompt', () => { prompts++; });
      let actor = null;
      let actorUuid = null;
      const out = { layers: {}, prompts: 0, restored: false, deleted: false, actorUuid: null };
      try {
        // A real compendium feat that carries a ChoiceSet rule (the grant target).
        const pack = game.packs.get('pf2e.feats-srd');
        const index = await pack.getIndex({ fields: ['img', 'system.rules'] });
        const target = index.find((e) => (e.system?.rules ?? []).some((r) => r.key === 'ChoiceSet'));
        if (!target) return { fatal: 'no feat with a ChoiceSet in pf2e.feats-srd' };
        out.targetUuid = target.uuid;

        CS.prototype.preCreate = async function (args) {
          calls.push({
            layer: globalThis.__agSpikeLayer,
            callId: args?.operation?.agentGateway?.callId ?? null,
            item: this.item?.name ?? null,
            flag: this.flag ?? null,
            actorId: this.actor?.id ?? null,
          });
          args.ruleSource.ignored = true; // never prompt, never call the original
        };

        actor = await Actor.create({ name: 'agent-gateway spike 49 (temporary)', type: 'character' });
        actorUuid = actor.uuid;
        out.actorUuid = actorUuid;

        const run = async (layer, data) => {
          globalThis.__agSpikeLayer = layer;
          const callId = 'spike-' + layer;
          try {
            await actor.createEmbeddedDocuments('Item', [data], { agentGateway: { callId } });
            out.layers[layer] = { expected: callId };
          } catch (e) {
            out.layers[layer] = { expected: callId, error: String(e?.message ?? e) };
          }
        };
        await run('top-level', { name: 'spike top-level feat', type: 'feat',
          system: { rules: [{ key: 'ChoiceSet', flag: 'spikeTop', choices: [{ value: 'a', label: 'A' }] }] } });
        await run('class-grant', { name: 'spike class', type: 'class',
          system: { items: { spike: { uuid: target.uuid, img: target.img || 'icons/svg/item-bag.svg', name: target.name, level: 1 } } } });
        await run('grantitem-child', { name: 'spike granter', type: 'feat',
          system: { rules: [{ key: 'GrantItem', uuid: target.uuid }] } });
      } finally {
        CS.prototype.preCreate = original;
        out.restored = CS.prototype.preCreate === original;
        Hooks.off('renderPickAThingPrompt', hookId);
        delete globalThis.__agSpikeLayer;
        if (actorUuid) {
          try { await (await fromUuid(actorUuid))?.delete(); } catch (e) { out.deleteError = String(e?.message ?? e); }
          out.deleted = (await fromUuid(actorUuid)) === null;
        }
        out.prompts = prompts;
      }
      for (const [layer, v] of Object.entries(out.layers)) {
        const mine = calls.filter((c) => c.layer === layer);
        v.calls = mine;
        v.callIdArrived = mine.some((c) => c.callId === v.expected);
      }
      return out;
    })()`)) as Record<string, unknown>;

    // Findings go in the PR description, layer by layer.
    console.log('SPIKE 49 RESULT ' + JSON.stringify(result, null, 2));
    expect(result.fatal, String(result.fatal)).toBeUndefined();
    expect(result.restored, 'original preCreate must be restored').toBe(true);
    expect(result.deleted, `RESIDUE: actor ${String(result.actorUuid)} still exists`).toBe(true);
    expect(result.prompts).toBe(0);
  }, 240_000);
});
