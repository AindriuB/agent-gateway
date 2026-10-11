/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  AGENT_CLASSES,
  CATEGORIES,
  DENY_ALL_MATRIX,
  validateMatrix,
  type AgentClass,
  type PolicyMatrix,
} from './matrix.js';
import { loadLimits, validateLimits, type StoredLimits } from '../ratelimit/config.js';

declare const game: any;
const NS = 'agent-gateway';
export const SNAPSHOT_KEY = 'worldPolicy';
export const MIGRATION_KEY = 'worldPolicySnapshotMigrated';
export const MATCH_NOTHING = '\u0000invalid-allowlist';
export interface WorldSnapshot {
  version: 1;
  world: PolicyMatrix;
  playerEnabled: boolean;
  headlessEnabled: boolean;
  folders: Record<AgentClass, string[]>;
  limits: StoredLimits;
}
export interface AdmittedSnapshot extends WorldSnapshot {
  valid: boolean;
  agentsCorrupt: boolean;
}
const object = (raw: unknown): Record<string, unknown> => {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid policy snapshot');
  return value as Record<string, unknown>;
};
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    throw Error('Incomplete policy snapshot');
};
export function validateSnapshot(raw: unknown): WorldSnapshot {
  const value = object(raw);
  exact(value, ['version', 'world', 'playerEnabled', 'headlessEnabled', 'folders', 'limits']);
  if (value.version !== 1) throw Error('Unknown policy snapshot');
  if (typeof value.playerEnabled !== 'boolean' || typeof value.headlessEnabled !== 'boolean')
    throw Error('Invalid policy flags');
  const world = object(value.world);
  exact(world, AGENT_CLASSES);
  for (const cls of AGENT_CLASSES) exact(object(world[cls]), CATEGORIES);
  const folders = object(value.folders);
  exact(folders, AGENT_CLASSES);
  const lists = Object.fromEntries(
    AGENT_CLASSES.map((cls) => {
      const list = folders[cls];
      if (
        !Array.isArray(list) ||
        list.some((id) => typeof id !== 'string' || !id || id === 'Folder.')
      )
        throw Error('Invalid policy folders');
      return [cls, [...new Set((list as string[]).map((id) => id.replace(/^Folder\./, '')))]];
    }),
  ) as Record<AgentClass, string[]>;
  const limits = object(value.limits);
  exact(limits, [...AGENT_CLASSES, 'agents']);
  return {
    version: 1,
    world: validateMatrix(world),
    playerEnabled: value.playerEnabled,
    headlessEnabled: value.headlessEnabled,
    folders: lists,
    limits: validateLimits(limits),
  };
}
const denied = (): AdmittedSnapshot => ({
  version: 1,
  valid: false,
  agentsCorrupt: true,
  world: validateMatrix(DENY_ALL_MATRIX),
  playerEnabled: false,
  headlessEnabled: false,
  folders: { playerAgents: [MATCH_NOTHING], gmAgents: [MATCH_NOTHING] },
  limits: { playerAgents: { read: 1, write: 1 }, gmAgents: { read: 1, write: 1 }, agents: {} },
});
/** Inspect all persisted records: a first-match lookup cannot establish uniqueness. */
function records(key: string): any[] {
  const storage = game.settings.storage.get('world');
  if (!storage || !Array.isArray(storage.contents)) throw Error('Policy storage inaccessible');
  const full = `${NS}.${key}`;
  const matches = storage.contents.filter(
    (doc: any) => doc.key === full || doc._source?.key === full,
  );
  if (matches.length > 1) throw Error('Policy initialization or repair required');
  for (const doc of matches) {
    if (
      typeof doc.id !== 'string' ||
      !doc.id ||
      doc.key !== full ||
      doc.user !== null ||
      typeof storage.get !== 'function' ||
      storage.get(doc.id) !== doc ||
      !doc._source ||
      typeof doc._source.value !== 'string' ||
      doc._source._id !== doc.id ||
      doc._source.key !== full ||
      doc._source.user !== null
    )
      throw Error('Policy record identity inconsistent');
    if (JSON.stringify(game.settings.get(NS, key)) !== JSON.stringify(doc.value))
      throw Error('Policy cache inconsistent');
    if (JSON.stringify(JSON.parse(doc._source.value)) !== JSON.stringify(doc.value))
      throw Error('Policy record value inconsistent');
  }
  return matches;
}
function migration(): boolean {
  const docs = records(MIGRATION_KEY);
  if (docs.length) {
    if (typeof docs[0].value !== 'boolean') throw Error('Invalid policy migration latch');
    return docs[0].value;
  }
  if (game.settings.get(NS, MIGRATION_KEY) !== false)
    throw Error('Policy migration state inaccessible');
  return false;
}
function legacy(raw: unknown): WorldSnapshot {
  const root = object(raw);
  exact(root, AGENT_CLASSES);
  const world = Object.fromEntries(AGENT_CLASSES.map((cls) => [cls, { ...object(root[cls]) }]));
  for (const cls of AGENT_CLASSES) exact(world[cls]!, CATEGORIES);
  for (const cls of AGENT_CLASSES)
    if ((world[cls] as Record<string, unknown>).code === 'allow')
      (world[cls] as Record<string, unknown>).code = 'ask_owner';
  const player = game.settings.get(NS, 'playerAgentsEnabled');
  const headless = game.settings.get(NS, 'headlessAgentsEnabled');
  const oldFolders = object(game.settings.get(NS, 'folderAllowlist'));
  if (Object.keys(oldFolders).some((key) => !AGENT_CLASSES.includes(key as AgentClass)))
    throw Error('Invalid legacy folders');
  const folders = Object.fromEntries(
    AGENT_CLASSES.map((cls) => [cls, Object.hasOwn(oldFolders, cls) ? oldFolders[cls] : []]),
  );
  const limits = object(game.settings.get(NS, 'rateLimits'));
  // Legacy omitted overrides inherit class limits; malformed overrides never do.
  return validateSnapshot({
    version: 1,
    world,
    playerEnabled: player,
    headlessEnabled: headless,
    folders,
    limits: { ...limits, agents: Object.hasOwn(limits, 'agents') ? limits.agents : {} },
  });
}
export function readWorldSnapshot(): AdmittedSnapshot {
  try {
    const migrated = migration();
    const docs = records(SNAPSHOT_KEY);
    const raw = docs.length ? docs[0].value : game.settings.get(NS, SNAPSHOT_KEY);
    const parsed = object(raw);
    if (Object.hasOwn(parsed, 'version')) {
      if (!migrated || docs.length !== 1) throw Error('Policy snapshot lacks migration authority');
      return { ...validateSnapshot(parsed), valid: true, agentsCorrupt: false };
    }
    if (migrated) throw Error('Policy downgrade refused');
    return { ...legacy(parsed), valid: true, agentsCorrupt: false };
  } catch {
    return denied();
  }
}
function requireGM(): void {
  if (game.user?.isGM !== true) throw Error('World policy requires a GM');
}
/** One world value is the publication boundary. No rollback may clobber another GM's proposal. */
export async function publishWorldSnapshot(proposal: unknown): Promise<void> {
  const snapshot = validateSnapshot(proposal);
  requireGM();
  records(SNAPSHOT_KEY);
  const migrated = migration();
  if (!migrated) {
    await game.settings.set(NS, MIGRATION_KEY, true);
    requireGM();
    if (!migration()) throw Error('Policy migration did not persist');
  }
  requireGM();
  records(SNAPSHOT_KEY);
  await game.settings.set(NS, SNAPSHOT_KEY, JSON.stringify(snapshot));
  requireGM();
  if (!migration() || records(SNAPSHOT_KEY).length !== 1 || !readWorldSnapshot().valid)
    throw Error('Policy initialization or repair required');
}
export function snapshotLimits(): ReturnType<typeof loadLimits> {
  const snapshot = readWorldSnapshot();
  return { ...loadLimits(snapshot.limits), agentsCorrupt: snapshot.agentsCorrupt };
}
