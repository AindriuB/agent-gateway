/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DEFAULT_OWNER_MATRIX,
  DEFAULT_WORLD_MATRIX,
  DENY_ALL_MATRIX,
  loadMatrix,
  validateMatrix,
  type AgentClass,
  type PolicyMatrix,
} from './matrix.js';

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
export const loadWorldPolicy = (): PolicyMatrix =>
  loadMatrix(read(WORLD_POLICY_KEY), DENY_ALL_MATRIX);

/** This client's owner policy; missing, unreadable or invalid cells apply no extra restriction. */
export const loadOwnerPolicy = (): PolicyMatrix =>
  loadMatrix(read(OWNER_POLICY_KEY), DEFAULT_OWNER_MATRIX);

/** Only a stored `true` enables; anything else, including a read failure, is off. */
export const playerAgentsEnabled = (): boolean => read(PLAYER_AGENTS_KEY) === true;
export const headlessAgentsEnabled = (): boolean => read(HEADLESS_AGENTS_KEY) === true;

/** Rejects an invalid matrix (including code `allow`) before it reaches storage. */
export async function saveWorldPolicy(matrix: unknown): Promise<void> {
  await game.settings.set(NS, WORLD_POLICY_KEY, JSON.stringify(validateMatrix(matrix)));
}

export async function saveOwnerPolicy(matrix: unknown): Promise<void> {
  await game.settings.set(NS, OWNER_POLICY_KEY, JSON.stringify(validateMatrix(matrix)));
}

/** A folder id no folder has: an unreadable allowlist then matches nothing (fail closed). */
const MATCH_NOTHING = '\u0000invalid-allowlist';

/** Allowed folder ids for an agent class; empty means no restriction. */
export function folderAllowlist(cls: AgentClass): string[] {
  let raw = read(FOLDER_ALLOWLIST_KEY);
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [MATCH_NOTHING];
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [MATCH_NOTHING];
  const list = (raw as Record<string, unknown>)[cls];
  if (list === undefined) return [];
  if (!Array.isArray(list)) return [MATCH_NOTHING];
  const ids = list
    .filter((v): v is string => typeof v === 'string' && v !== '')
    .map((v) => v.replace(/^Folder\./, ''));
  return list.length > 0 && ids.length === 0 ? [MATCH_NOTHING] : ids;
}

export const DEFAULT_FOLDER_ALLOWLIST = JSON.stringify({ playerAgents: [], gmAgents: [] });

export function registerPolicySettings(): void {
  game.settings.register(NS, PLAYER_AGENTS_KEY, {
    name: 'AGENT_GATEWAY.Settings.playerAgentsEnabled.name',
    hint: 'AGENT_GATEWAY.Settings.playerAgentsEnabled.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    restricted: true,
  });
  game.settings.register(NS, HEADLESS_AGENTS_KEY, {
    name: 'AGENT_GATEWAY.Settings.headlessAgentsEnabled.name',
    hint: 'AGENT_GATEWAY.Settings.headlessAgentsEnabled.hint',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
    restricted: true,
  });
  game.settings.register(NS, WORLD_POLICY_KEY, {
    name: 'AGENT_GATEWAY.Settings.worldPolicy.name',
    hint: 'AGENT_GATEWAY.Settings.worldPolicy.hint',
    scope: 'world',
    config: false,
    type: String, // JSON matrix; edited through saveWorldPolicy, which validates
    default: JSON.stringify(DEFAULT_WORLD_MATRIX),
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
  });
}
