/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  loadMatrix,
  validateMatrix,
  type AgentClass,
  type PolicyMatrix,
} from './matrix.js';

import { readWorldSnapshot, publishWorldSnapshot, MIGRATION_KEY } from './snapshot.js';

declare const game: any;

const NS = 'agent-gateway';

export const WORLD_POLICY_KEY = 'worldPolicy';
export const OWNER_POLICY_KEY = 'ownerPolicy';
export const FOLDER_ALLOWLIST_KEY = 'folderAllowlist';
export const PLAYER_AGENTS_KEY = 'playerAgentsEnabled';
export const HEADLESS_AGENTS_KEY = 'headlessAgentsEnabled';

/**
 * Enforcement note. World settings are readable by every client, and a Foundry module runs in the
 * browser of the user it acts for, so this module is the enforcement point in that user's own
 * client. A user who patches their own copy of the module code can bypass it; the Foundry
 * server's permission checks (layer 5) are the backstop for what a user may do at all. Both the
 * world ceiling and the owner policy are read here, in the calling user's client, and are
 * combined by taking the stricter value per cell, so editing the client-scope owner policy can
 * only tighten, never loosen, what the world setting allows.
 */
const read = (key: string): unknown => {
  try {
    return game.settings.get(NS, key);
  } catch {
    return undefined;
  }
};

/**
 * The world ceiling. An unset setting holds the registered default matrix; anything unparseable,
 * not an object, or missing or invalid in a cell is deny (fail strict), never a default.
 */
export const loadWorldPolicy = (): PolicyMatrix => readWorldSnapshot().world;

/** This client's owner policy; missing, unreadable or invalid cells apply no extra restriction. */
export const loadOwnerPolicy = (): PolicyMatrix =>
  loadMatrix(read(OWNER_POLICY_KEY), DEFAULT_OWNER_MATRIX);

/** Only a stored `true` enables; anything else, including a read failure, is off. */
export const playerAgentsEnabled = (): boolean => readWorldSnapshot().playerEnabled;
export const headlessAgentsEnabled = (): boolean => readWorldSnapshot().headlessEnabled;

/** Rejects an invalid matrix (including code `allow`) before it reaches storage. */
export async function saveWorldPolicy(matrix: unknown): Promise<void> {
  const validated = validateMatrix(matrix);
  const current = readWorldSnapshot();
  if (!current.valid) throw Error('Policy initialization or repair required');
  await publishWorldSnapshot({
    version: 1,
    world: validated,
    playerEnabled: current.playerEnabled,
    headlessEnabled: current.headlessEnabled,
    folders: current.folders,
    limits: current.limits,
  });
}

export async function saveOwnerPolicy(matrix: unknown): Promise<void> {
  await game.settings.set(NS, OWNER_POLICY_KEY, JSON.stringify(validateMatrix(matrix)));
}

/** Allowed folder IDs from one complete world snapshot. */
export function folderAllowlist(cls: AgentClass): string[] {
  return readWorldSnapshot().folders[cls];
}

export const DEFAULT_FOLDER_ALLOWLIST = JSON.stringify({ playerAgents: [], gmAgents: [] });

const policyListeners = new Set<() => void>();

/** Called when a setting that decides the visible tool set changes (the folder list does not). */
export function onPolicyChange(fn: () => void): () => void {
  policyListeners.add(fn);
  return () => policyListeners.delete(fn);
}
const policyChanged = (): void => {
  for (const fn of policyListeners) fn();
};

export function registerPolicySettings(): void {
  game.settings.register(NS, MIGRATION_KEY, {
    name: 'AGENT_GATEWAY.Settings.worldPolicy.name',
    hint: 'AGENT_GATEWAY.Settings.worldPolicy.hint',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
    restricted: true,
    onChange: policyChanged,
  });
  game.settings.register(NS, PLAYER_AGENTS_KEY, {
    name: 'AGENT_GATEWAY.Settings.playerAgentsEnabled.name',
    hint: 'AGENT_GATEWAY.Settings.playerAgentsEnabled.hint',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
    onChange: policyChanged,
    restricted: true,
  });
  game.settings.register(NS, HEADLESS_AGENTS_KEY, {
    name: 'AGENT_GATEWAY.Settings.headlessAgentsEnabled.name',
    hint: 'AGENT_GATEWAY.Settings.headlessAgentsEnabled.hint',
    scope: 'world',
    config: false,
    type: Boolean,
    default: false,
    onChange: policyChanged,
    restricted: true,
  });
  game.settings.register(NS, WORLD_POLICY_KEY, {
    name: 'AGENT_GATEWAY.Settings.worldPolicy.name',
    hint: 'AGENT_GATEWAY.Settings.worldPolicy.hint',
    scope: 'world',
    config: false,
    type: String, // JSON matrix; edited through saveWorldPolicy, which validates
    default: JSON.stringify(DEFAULT_WORLD_MATRIX),
    onChange: policyChanged,
    restricted: true,
  });
  game.settings.register(NS, FOLDER_ALLOWLIST_KEY, {
    name: 'AGENT_GATEWAY.Settings.folderAllowlist.name',
    hint: 'AGENT_GATEWAY.Settings.folderAllowlist.hint',
    scope: 'world',
    config: false,
    type: String, // JSON {playerAgents: string[], gmAgents: string[]} of folder ids
    default: DEFAULT_FOLDER_ALLOWLIST,
    restricted: true,
  });
  game.settings.register(NS, OWNER_POLICY_KEY, {
    name: 'AGENT_GATEWAY.Settings.ownerPolicy.name',
    hint: 'AGENT_GATEWAY.Settings.ownerPolicy.hint',
    scope: 'client',
    config: false,
    type: String, // JSON matrix; edited through saveOwnerPolicy, which validates
    default: JSON.stringify(DEFAULT_OWNER_MATRIX),
    onChange: policyChanged,
  });
}
