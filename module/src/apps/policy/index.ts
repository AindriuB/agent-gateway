import {
  readOfflineEventPolicy,
  saveOfflineEventPolicy,
  purgeOfflineEvents,
} from '../../events/offline-setting.js';
import { getLinkClient } from '../../link/runtime.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { AGENT_CLASSES, CATEGORIES } from '../../policy/matrix.js';
import { loadOwnerPolicy, saveOwnerPolicy } from '../../policy/store.js';
import { readWorldSnapshot, publishWorldSnapshot } from '../../policy/snapshot.js';
import { isDecision, strictness } from '../../policy/lattice.js';
import { policyContext, validatePolicyForm, type PolicyState } from './model.js';

declare const game: any;
declare const ui: any;
const NS = 'agent-gateway';

export function currentPolicyState(): PolicyState {
  const snapshot = readWorldSnapshot();
  return {
    isGM: game.user?.isGM === true,
    world: snapshot.world,
    owner: loadOwnerPolicy(),
    playerEnabled: snapshot.playerEnabled,
    headlessEnabled: snapshot.headlessEnabled,
    // Only GMs need folder metadata; players see only the ceiling and their own matrix.
    folders:
      game.user?.isGM === true
        ? (game.folders?.contents ?? [])
            .map((f: any) => ({ id: String(f.id), name: String(f.name) }))
            .sort((a: any, b: any) => a.name.localeCompare(b.name))
        : [],
    allowlists: snapshot.folders,
    limits: snapshot.limits,
    agentsCorrupt: snapshot.agentsCorrupt,
  };
}

export async function savePolicyForm(values: Record<string, unknown>): Promise<boolean> {
  try {
    const validated = validatePolicyForm(values, currentPolicyState());
    if ('world' in validated) {
      await saveOwnerPolicy(validated.owner);
      if (game.user?.isGM !== true) throw Error('World policy requires a GM');
      await publishWorldSnapshot({
        version: 1,
        world: validated.world,
        playerEnabled: validated.playerEnabled,
        headlessEnabled: validated.headlessEnabled,
        folders: validated.folders,
        limits: validated.limits,
      });
    } else await saveOwnerPolicy(validated.owner);
    ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.PolicyApp.saved'));
    return true;
  } catch {
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
      return { ...policyContext(currentPolicyState()), offlineEvents: readOfflineEventPolicy() };
    }
    async _onRender(context: object, options: object): Promise<void> {
      await super._onRender?.(context, options);
      if (game.user?.isGM !== true) return;
      const saveOffline = this.element.querySelector('[data-offline-save]');
      const purgeOffline = this.element.querySelector('[data-offline-purge]');
      if (saveOffline)
        saveOffline.onclick = async () => {
          try {
            const enabled = this.element.querySelector('[data-offline-enabled]')?.checked;
            const retentionDays = Number(this.element.querySelector('[data-offline-days]')?.value);
            await saveOfflineEventPolicy({ enabled, retentionDays });
            ui.notifications.info(game.i18n.localize('AGENT_GATEWAY.OfflineEvents.saved'));
          } catch {
            ui.notifications.error(game.i18n.localize('AGENT_GATEWAY.OfflineEvents.failed'));
          }
        };
      if (purgeOffline)
        purgeOffline.onclick = async () => {
          try {
            const count = await purgeOfflineEvents(getLinkClient());
            ui.notifications.info(
              game.i18n.format('AGENT_GATEWAY.OfflineEvents.purged', { count }),
            );
          } catch {
            ui.notifications.error(game.i18n.localize('AGENT_GATEWAY.OfflineEvents.failed'));
          }
        };
      for (const cls of AGENT_CLASSES)
        for (const cat of CATEGORIES) {
          const world = this.element.querySelector(`select[name="world_${cls}_${cat}"]`);
          const owner = this.element.querySelector(`select[name="owner_${cls}_${cat}"]`);
          if (!world || !owner) continue;
          // Assignment keeps repeated renders idempotent on retained controls.
          world.onchange = () => {
            if (game.user?.isGM !== true || !isDecision(world.value)) return;
            for (const option of owner.options)
              option.disabled =
                !isDecision(option.value) ||
                strictness(option.value) < strictness(world.value) ||
                (cat === 'code' && option.value === 'allow');
            if (!isDecision(owner.value) || strictness(owner.value) < strictness(world.value))
              owner.value = world.value;
          };
        }
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
