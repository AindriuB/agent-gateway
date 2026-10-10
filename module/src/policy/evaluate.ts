import { combine, type Decision } from './lattice.js';
import type { AgentClass, Category, PolicyMatrix } from './matrix.js';

export interface PolicyInputs {
  world: PolicyMatrix;
  owner: PolicyMatrix;
  playerAgentsEnabled: boolean;
  headlessAgentsEnabled: boolean;
}

export interface CallFacts {
  isGM: boolean;
  headless: boolean;
  category: Category;
}

export type Verdict =
  | { kind: 'disabled'; setting: 'playerAgentsEnabled' | 'headlessAgentsEnabled' }
  | { kind: 'decision'; decision: Decision; agentClass: AgentClass; category: Category };

/**
 * The hard rules first (player and headless agents off until enabled), then the matrix: the
 * stricter of the world ceiling and the owner policy, and `code` is never `allow` whatever either
 * says.
 */
export function evaluate(inputs: PolicyInputs, call: CallFacts): Verdict {
  if (!call.isGM && !inputs.playerAgentsEnabled) {
    return { kind: 'disabled', setting: 'playerAgentsEnabled' };
  }
  if (call.headless && !inputs.headlessAgentsEnabled) {
    return { kind: 'disabled', setting: 'headlessAgentsEnabled' };
  }
  const agentClass: AgentClass = call.isGM ? 'gmAgents' : 'playerAgents';
  let decision = combine(
    inputs.world[agentClass][call.category],
    inputs.owner[agentClass][call.category],
  );
  if (call.category === 'code' && decision === 'allow') decision = 'ask_owner';
  return { kind: 'decision', decision, agentClass, category: call.category };
}
