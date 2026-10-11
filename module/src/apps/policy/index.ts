/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { AGENT_CLASSES } from '../../policy/matrix.js';
import {
  folderAllowlist,
  headlessAgentsEnabled,
  loadOwnerPolicy,
  loadWorldPolicy,
  playerAgentsEnabled,
  saveOwnerPolicy,
  saveWorldPolicy,
  FOLDER_ALLOWLIST_KEY,
  PLAYER_AGENTS_KEY,
  HEADLESS_AGENTS_KEY,
} from '../../policy/store.js';
import { loadRateLimits, saveRateLimits } from '../../ratelimit/store.js';
import { policyContext, validatePolicyForm, type PolicyState } from './model.js';

declare const game: any;
declare const ui: any;
const NS = 'agent-gateway';

export function currentPolicyState(): PolicyState {
  const limits = loadRateLimits();
  return {
    isGM: game.user?.isGM === true,
    world: loadWorldPolicy(),
    owner: loadOwnerPolicy(),
    playerEnabled: playerAgentsEnabled(),
    headlessEnabled: headlessAgentsEnabled(),
    // Only GMs need folder metadata; players see only the ceiling and their own matrix.
    folders:
      game.user?.isGM === true
        ? (game.folders?.contents ?? [])
            .map((f: any) => ({ id: String(f.id), name: String(f.name) }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        : [],
    allowlists: Object.fromEntries(AGENT_CLASSES.map((cls) => [cls, folderAllowlist(cls)])),
    limits: { ...limits.classes, agents: Object.fromEntries(limits.agents) },
    agentsCorrupt: limits.agentsCorrupt,
  };
}

export async function savePolicyForm(values: Record<string, unknown>): Promise<boolean> {
  let savingWorld = false;
  try {
    const validated = validatePolicyForm(values, currentPolicyState());
    if ('world' in validated) {
      savingWorld = true;
      // Quiesce access before changing restrictions, including already-enabled agents.
      // A rejected disable aborts the save before any restriction is changed.
      await game.settings.set(NS, PLAYER_AGENTS_KEY, false);
      await game.settings.set(NS, HEADLESS_AGENTS_KEY, false);
      await saveWorldPolicy(validated.world);
      await game.settings.set(NS, FOLDER_ALLOWLIST_KEY, JSON.stringify(validated.folders));
      await saveRateLimits(validated.limits);
      await saveOwnerPolicy(validated.owner);
      // All restrictions are persisted before either class can gain access.
      if (validated.playerEnabled) await game.settings.set(NS, PLAYER_AGENTS_KEY, true);
      if (validated.headlessEnabled) await game.settings.set(NS, HEADLESS_AGENTS_KEY, true);
    } else await saveOwnerPolicy(validated.owner);
    ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.PolicyApp.saved'));
    return true;
  } catch {
    if (savingWorld) {
      // Settings are not transactional. Never restore broader access after a partial save;
      // attempt both disables even if one fails (an unavailable backend may reject rollback).
      for (const key of [PLAYER_AGENTS_KEY, HEADLESS_AGENTS_KEY]) {
        try {
          await game.settings.set(NS, key, false);
        } catch {
          // Still try to close the other gate and report the failed save below.
        }
      }
    }
    ui.notifications.error(game.i18n.localize('AGENT_GATEWAY.PolicyApp.invalid'));
    return false;
  }
}

/** Resolve the Foundry base lazily, as with the pairing application. */
export function createPolicyApp(): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());
  return class PolicyApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-policy',
      tag: 'form',
      window: {
        title: 'AGENT_GATEWAY.PolicyApp.title',
        icon: 'fa-solid fa-shield-halved',
        resizable: true,
      },
      position: { width: 740, height: 740 },
      form: { handler: PolicyApp.onSubmit, closeOnSubmit: false },
    };
    static PARTS = { form: { template: `modules/${NS}/templates/policy/policy.hbs` } };
    async _prepareContext(): Promise<object> {
      return policyContext(currentPolicyState());
    }
    static async onSubmit(
      this: any,
      _event: Event,
      _form: HTMLFormElement,
      data: any,
    ): Promise<void> {
      if (await savePolicyForm(data?.object ?? {})) await this.render();
    }
  };
}
let appClass: any;
export function registerPolicyMenu(): void {
  appClass ??= createPolicyApp();
  game.settings.registerMenu(NS, 'policy', {
    name: 'AGENT_GATEWAY.PolicyApp.title',
    label: 'AGENT_GATEWAY.PolicyApp.open',
    hint: 'AGENT_GATEWAY.PolicyApp.hint',
    icon: 'fa-solid fa-shield-halved',
    type: appClass,
    restricted: false,
  });
}
