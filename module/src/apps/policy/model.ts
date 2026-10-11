import { combine, DECISIONS, strictness } from '../../policy/lattice.js';
import {
  AGENT_CLASSES,
  CATEGORIES,
  validateMatrix,
  type PolicyMatrix,
} from '../../policy/matrix.js';
import { BUCKETS, MAX_LIMIT, validateLimits, type StoredLimits } from '../../ratelimit/config.js';

export interface PolicyState {
  isGM: boolean;
  world: PolicyMatrix;
  owner: PolicyMatrix;
  playerEnabled: boolean;
  headlessEnabled: boolean;
  folders: Array<{ id: string; name: string }>;
  allowlists: Record<string, string[]>;
  limits: StoredLimits;
  agentsCorrupt: boolean;
}

/** Template data contains decisions and labels, never HTML from world documents. */
export function policyContext(state: PolicyState) {
  const rows = (matrix: PolicyMatrix, owner: boolean) =>
    AGENT_CLASSES.map((cls) => ({
      label: `AGENT_GATEWAY.PolicyApp.${cls}`,
      cells: CATEGORIES.map((cat) => {
        const current = owner ? combine(state.world[cls][cat], matrix[cls][cat]) : matrix[cls][cat];
        return {
          name: `${owner ? 'owner' : 'world'}_${cls}_${cat}`,
          label: `AGENT_GATEWAY.PolicyApp.${cat}`,
          value: current,
          options: DECISIONS.filter((d) => cat !== 'code' || d !== 'allow').map((value) => ({
            value,
            label: `AGENT_GATEWAY.PolicyApp.${value}`,
            selected: value === current,
            disabled: owner && strictness(value) < strictness(state.world[cls][cat]),
          })),
        };
      }),
    }));
  return {
    isGM: state.isGM,
    worldRows: rows(state.world, false),
    ownerRows: rows(state.owner, true),
    playerEnabled: state.playerEnabled,
    headlessEnabled: state.headlessEnabled,
    classes: AGENT_CLASSES.map((cls) => ({
      label: `AGENT_GATEWAY.PolicyApp.${cls}`,
      folderName: `folders_${cls}`,
      folders: [
        ...state.folders,
        ...state.allowlists[cls]!.filter((id) => !state.folders.some((f) => f.id === id)).map(
          (id) => ({ id, name: id }),
        ),
      ].map((f) => ({ ...f, selected: state.allowlists[cls]!.includes(f.id) })),
      buckets: BUCKETS.map((bucket) => ({
        name: `limits_${cls}_${bucket}`,
        label: `AGENT_GATEWAY.PolicyApp.${bucket}`,
        value: state.limits[cls][bucket],
      })),
    })),
    maxLimit: MAX_LIMIT,
  };
}

/** Validate everything before the first settings write; re-read the ceiling at submit time. */
export function validatePolicyForm(values: Record<string, unknown>, state: PolicyState) {
  const matrix = (prefix: string): PolicyMatrix =>
    validateMatrix(
      Object.fromEntries(
        AGENT_CLASSES.map((cls) => [
          cls,
          Object.fromEntries(CATEGORIES.map((cat) => [cat, values[`${prefix}_${cls}_${cat}`]])),
        ]),
      ),
    );
  if (!state.isGM && Object.keys(values).some((key) => !key.startsWith('owner_')))
    throw new Error('world edit refused');
  const world = state.isGM ? matrix('world') : state.world;
  const owner = matrix('owner');
  for (const cls of AGENT_CLASSES)
    for (const cat of CATEGORIES) {
      if (strictness(owner[cls][cat]) < strictness(world[cls][cat]))
        throw new Error('owner exceeds ceiling');
    }
  if (!state.isGM) return { owner };
  // This app does not edit overrides: never turn an unreadable block into empty defaults.
  if (state.agentsCorrupt)
    throw new Error('Repair per-agent overrides before saving world policies');
  const toggle = (key: string) => {
    const v = values[key];
    if (v !== undefined && typeof v !== 'boolean') throw new Error('invalid toggle');
    return v === true;
  };
  const folders = Object.fromEntries(
    AGENT_CLASSES.map((cls) => {
      const raw = values[`folders_${cls}`] ?? [];
      const list = typeof raw === 'string' ? [raw] : raw;
      if (
        !Array.isArray(list) ||
        list.some(
          (id) =>
            typeof id !== 'string' ||
            ![...state.folders.map((f) => f.id), ...state.allowlists[cls]!].includes(id),
        )
      )
        throw new Error('invalid folder');
      return [cls, [...new Set(list)]];
    }),
  );
  const limits = validateLimits({
    ...Object.fromEntries(
      AGENT_CLASSES.map((cls) => [
        cls,
        Object.fromEntries(
          BUCKETS.map((bucket) => {
            const v = values[`limits_${cls}_${bucket}`];
            if (typeof v !== 'number' && (typeof v !== 'string' || !/^\d+$/.test(v)))
              throw new Error('invalid limit');
            return [bucket, Number(v)];
          }),
        ),
      ]),
    ),
    agents: state.limits.agents,
  });
  return {
    owner,
    world,
    folders,
    limits,
    playerEnabled: toggle('playerEnabled'),
    headlessEnabled: toggle('headlessEnabled'),
  };
}
