/* eslint-disable @typescript-eslint/no-explicit-any */
import { TOOLS, type ToolDefinition } from '@agent-gateway/protocol';
import type { Stage } from '../ops/stages.js';
import type { DispatchResult } from '../ops/types.js';
import { evaluate, type PolicyInputs } from './evaluate.js';
import { CATEGORIES, type Category } from './matrix.js';
import {
  headlessAgentsEnabled,
  loadOwnerPolicy,
  loadWorldPolicy,
  playerAgentsEnabled,
} from './store.js';
import './types.js';

declare const game: any;

export const POLICY_STAGE_ORDER = 20;

const t = (key: string, data: Record<string, string> = {}): string => {
  const i18n = game?.i18n;
  return typeof i18n?.format === 'function' ? String(i18n.format(key, data)) : key;
};

const denied = (message: string): DispatchResult => ({ error: { code: 'DENIED', message } });

export function liveInputs(): PolicyInputs {
  return {
    world: loadWorldPolicy(),
    owner: loadOwnerPolicy(),
    playerAgentsEnabled: playerAgentsEnabled(),
    headlessAgentsEnabled: headlessAgentsEnabled(),
  };
}

/**
 * The policy stage. It runs after the dispatcher has checked the role and validated the
 * arguments, so it only judges well-formed calls from a user who may use the tool at all, and an
 * invalid call never learns the policy. An unknown tool or category is denied.
 */
export function createPolicyStage(
  config: {
    tools?: readonly ToolDefinition[];
    inputs?: () => PolicyInputs;
  } = {},
): Stage {
  const tools = config.tools ?? TOOLS;
  const inputs = config.inputs ?? liveInputs;
  return {
    name: 'policy',
    order: POLICY_STAGE_ORDER,
    async run(ctx, next) {
      const category = tools.find((d) => d.name === ctx.tool)?.category as Category | undefined;
      if (!category || !(CATEGORIES as readonly string[]).includes(category)) {
        return denied(t('AGENT_GATEWAY.Policy.unknownCategory', { tool: ctx.tool }));
      }
      const verdict = evaluate(inputs(), {
        isGM: ctx.user.isGM,
        headless: ctx.agent.headless,
        category,
      });
      if (verdict.kind === 'disabled') {
        const key =
          verdict.setting === 'playerAgentsEnabled'
            ? 'AGENT_GATEWAY.Policy.playerAgentsDisabled'
            : 'AGENT_GATEWAY.Policy.headlessAgentsDisabled';
        return denied(t(key, { setting: t(`AGENT_GATEWAY.Settings.${verdict.setting}.name`) }));
      }
      const { decision } = verdict;
      if (decision === 'deny') return denied(t('AGENT_GATEWAY.Policy.denied', { category }));
      if (decision === 'allow') return next();
      const approver = decision === 'ask_gm' ? 'gm' : 'owner';
      ctx.approval = { approver };
      // The approval stage (30) takes it from here; the dispatcher refuses an unapproved call.
      return next();
    },
  };
}

export const policyStage = createPolicyStage();
