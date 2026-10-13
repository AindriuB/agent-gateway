/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CharacterBuildChange } from '@agent-gateway/protocol';
import type { BuildHook, BuildPayload } from '../build.js';
import type { AdapterExecutionContext } from '../types.js';
import { AdapterUnsupportedError } from '../types.js';
import { invalid } from '../../tools/_write.js';
import { advancementOf, leavesAdvancementsUnapplied } from './embed.js';

declare const CONFIG: any;
declare const Hooks: any;

// Written against dnd5e 6.0.6; line references are to systems/dnd5e/dnd5e.mjs of that release.
//
// Scope. dnd5e's build steps (ability scores, hit points, class/species/background features,
// proficiencies, ASIs) are AdvancementManager steps (dnd5e.mjs:25085), which are application
// windows driven by a person; there is no headless entry point that applies them. This hook
// therefore supports only what is a plain Actor field and fits the interface: skill proficiency
// ranks (system.skills.<key>.value, 0, 1 or 2; :83798-83801). Everything else is refused with a
// message. Ability scores and hit points are plain fields (system.abilities.<key>.value,
// system.attributes.hp) that document_update can set; the interface has no place for them.
const MAX_RANK = 2;
const MAX_ROWS = 64;
const own = (o: unknown, k: string): boolean =>
  !!o && typeof o === 'object' && Object.hasOwn(o as object, k);
const list = (v: unknown): any[] => {
  if (!v) return [];
  try {
    return Array.from(v as Iterable<unknown>);
  } catch {
    return [];
  }
};
const isCharacter = (actor: any): boolean => actor?.type === 'character';

const REFUSED: Record<string, string> = {
  attribute_boost:
    'dnd5e has no attribute boosts: ability scores come from advancement steps that need the sheet. Set system.abilities.<key>.value with document_update instead',
  key_attribute: 'dnd5e has no key attribute',
  feat_slot: 'dnd5e has no feat slots',
};

function describe(actor: any): BuildPayload {
  if (!isCharacter(actor)) return { supported: false, boosts: [], skills: [], featSlots: [] };
  const skills: BuildPayload['skills'] = [];
  let half = 0;
  for (const [skill, s] of Object.entries<any>(actor.system?.skills ?? {})) {
    if (skills.length >= MAX_ROWS) break;
    if (s?.value === 0.5) half += 1;
    else if (Number.isInteger(s?.value) && s.value >= 0 && s.value <= MAX_RANK)
      skills.push({ skill: skill.slice(0, 64), rank: s.value as number });
  }
  const notes: string[] = [];
  if (half) notes.push(`${half} skill(s) have half proficiency, which has no rank and is omitted.`);
  const pending = list(actor.items).filter((i) =>
    leavesAdvancementsUnapplied(i?._source ?? i),
  ).length;
  if (pending)
    notes.push(
      `${pending} embedded class, species, background or feat Item(s) carry advancements; embedding does not apply them, so hit points, granted items and proficiencies come only from changes made separately.`,
    );
  return {
    supported: true,
    boosts: [],
    skills,
    featSlots: [],
    ...(notes.length ? { message: notes.join(' ').slice(0, 2000) } : {}),
  };
}

function plan(actor: any, changes: readonly CharacterBuildChange[]): Record<string, number> {
  const patch: Record<string, number> = {};
  const skills = actor.system?.skills;
  for (const c of changes) {
    if (c.kind !== 'skill_rank') invalid(REFUSED[c.kind] ?? 'Unsupported build change');
    if (!c.skill || !own(CONFIG.DND5E?.skills, c.skill) || !own(skills, c.skill))
      invalid('Unknown skill');
    if (c.rank === undefined) invalid('A skill rank is required');
    if (c.rank! > MAX_RANK)
      invalid(
        `dnd5e skill proficiency is 0 (none), 1 (proficient) or 2 (expertise), not ${c.rank}`,
      );
    const key = `system.skills.${c.skill}.value`;
    if (own(patch, key)) invalid('Duplicate skill within one batch');
    patch[key] = c.rank!;
  }
  return patch;
}

const sourceSkills = (actor: any): string => {
  let skills: unknown;
  try {
    skills = typeof actor.toObject === 'function' ? actor.toObject().system?.skills : undefined;
  } catch {
    skills = undefined;
  }
  return JSON.stringify(
    Object.entries<any>((skills as object) ?? {}).map(([k, v]) => [k, v?.value ?? null]),
  );
};

/** Actors with a build call running; a second caller is refused, not queued. */
const running = new Set<string>();
const BUSY = 'Another build is still running on this Actor; retry shortly.';

async function apply(
  actor: any,
  changes: readonly CharacterBuildChange[],
  context: AdapterExecutionContext,
): Promise<BuildPayload> {
  if (!isCharacter(actor)) throw new AdapterUnsupportedError();
  if (typeof context?.snapshot !== 'function' || !context.callOptions)
    throw new Error('Audit context unavailable');
  const key = String(actor.uuid);
  if (running.has(key)) invalid(BUSY);
  running.add(key);
  try {
    // The whole batch is validated before anything is snapshotted or written.
    const patch = plan(actor, changes);
    const planned = sourceSkills(actor);
    await context.snapshot(actor.uuid);
    if (sourceSkills(actor) !== planned)
      invalid('The build changed during this call; read it again and retry.');
    let uncorrelated = 0;
    const id = Hooks.on('updateItem', (doc: any, ...args: unknown[]) => {
      const options: any = args[1];
      if (doc?.parent === actor && typeof options?.agentGateway?.callId !== 'string')
        uncorrelated += 1;
    });
    try {
      // One update, so the batch lands whole or not at all; fresh options carry only the audit id.
      await actor.update(patch, {
        ...context.callOptions,
        agentGateway: { ...context.callOptions.agentGateway },
      });
    } finally {
      Hooks.off('updateItem', id);
    }
    const out = describe(actor);
    const note = uncorrelated
      ? ` ${uncorrelated} uncorrelated Item write(s) were observed during the call; they are not undoable here.`
      : '';
    const message = `${out.message ?? ''}${note}`.trim().slice(0, 2000);
    return message ? { ...out, message } : out;
  } finally {
    running.delete(key);
  }
}

/** What embedding this Item would leave undone. Reads only; there are no prompts to answer. */
function listChoices(source: any): Promise<{ choices: never[]; message?: string }> {
  const n = advancementOf(source).length;
  return Promise.resolve({
    choices: [],
    ...(n
      ? {
          message: `This Item has ${n} advancement(s). Embedding it does not apply them (no hit points, granted items or proficiencies), and no choices can be answered.`,
        }
      : {}),
  });
}

export const dnd5eBuildHook: BuildHook = Object.freeze({
  systemId: 'dnd5e',
  describe,
  apply,
  listChoices: (source: unknown) => listChoices(source),
});
