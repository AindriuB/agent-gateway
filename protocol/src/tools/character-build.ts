import { z } from 'zod';
import { defineTool } from './define.js';

const attribute = z.string().min(1).max(32);
export const choiceListing = z.strictObject({
  flag: z.string().min(1).max(64).describe('ChoiceSet flag to answer'),
  itemUuid: z.string().max(500).describe('UUID of the item that carries the choice'),
  prompt: z.string().max(200).describe('Prompt text'),
  options: z
    .array(
      z.strictObject({
        value: z.string().max(500).describe('Value to supply (numbers as text)'),
        label: z.string().max(200).describe('Option label'),
      }),
    )
    .max(50)
    .describe('Selectable options (empty when unsupported)'),
  truncated: z.boolean().describe('Whether the option list was cut at 50'),
  unsupported: z
    .string()
    .max(100)
    .optional()
    .describe('Why the gateway cannot answer this choice, if it cannot'),
});
export type ChoiceListing = z.infer<typeof choiceListing>;

export const characterBuildOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).optional().describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  supported: z.boolean().describe('Whether the active system supports character building'),
  boosts: z
    .array(
      z.strictObject({
        source: z.enum(['ancestry', 'background', 'class', 'level']).describe('Boost source'),
        level: z.number().int().min(1).max(20).optional().describe('Level of a level boost'),
        slot: z.string().min(1).max(100).optional().describe('Slot key of a sourced boost'),
        attribute: attribute.optional().describe('Selected attribute, if any'),
        allowed: z.array(attribute).max(8).optional().describe('Attributes the slot allows'),
      }),
    )
    .max(128)
    .describe('Attribute boost state'),
  keyAttribute: z
    .strictObject({
      selected: attribute.optional().describe('Selected key attribute'),
      allowed: z.array(attribute).max(8).describe('Attributes the class allows'),
    })
    .optional()
    .describe('Class key attribute state'),
  skills: z
    .array(
      z.strictObject({
        skill: z.string().min(1).max(64).describe('Skill slug'),
        rank: z.number().int().min(0).max(4).describe('Proficiency rank 0-4'),
      }),
    )
    .max(128)
    .describe('Skill ranks'),
  featSlots: z
    .array(
      z.strictObject({
        group: z.string().min(1).max(100).describe('Feat group ID'),
        slot: z.string().min(1).max(100).describe('Slot ID'),
        level: z.number().int().min(0).max(20).optional().describe('Slot level'),
        itemUuid: z.string().min(1).max(256).optional().describe('Feat Item UUID in the slot'),
        itemName: z.string().max(200).optional().describe('Feat name in the slot'),
      }),
    )
    .max(128)
    .describe('Feat slot assignments'),
  choices: z
    .array(choiceListing)
    .max(64)
    .optional()
    .describe('ChoiceSet choices an item and its grants will ask for (listChoices only)'),
  message: z.string().max(2000).optional().describe('Disclosure or note about the result'),
});
export type CharacterBuildOutput = z.infer<typeof characterBuildOutput>;

export const characterBuildChange = z.strictObject({
  kind: z
    .enum(['attribute_boost', 'key_attribute', 'skill_rank', 'feat_slot'])
    .describe('Change kind'),
  source: z.enum(['ancestry', 'background', 'class', 'level']).optional().describe('Boost source'),
  level: z.number().int().min(1).max(20).optional().describe('Level of a level boost'),
  slot: z.string().min(1).max(100).optional().describe('Boost or feat slot key'),
  attribute: attribute.optional().describe('Attribute key, for example str'),
  skill: z.string().min(1).max(64).optional().describe('Skill slug'),
  rank: z.number().int().min(0).max(4).optional().describe('Proficiency rank 0-4'),
  itemUuid: z.string().min(1).max(256).optional().describe('Embedded feat Item UUID'),
});
export type CharacterBuildChange = z.infer<typeof characterBuildChange>;

export const characterBuild = defineTool({
  name: 'character_build',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description:
    'Read character-build state of an owned world Actor (boosts, key attribute, skill ranks, feat slots), or apply a bounded batch of build changes under write policy and approval. With listChoices (GM only, no actor), list the choices a compendium Item and its grants will ask for. Supported on pf2e only.',
  input: z
    .strictObject({
      actorUuid: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe('Canonical owned world Actor UUID (required unless listChoices is given)'),
      changes: z
        .array(characterBuildChange)
        .max(32)
        .optional()
        .describe('Optional build changes requiring write policy and approval'),
      listChoices: z
        .string()
        .min(1)
        .max(500)
        .optional()
        .describe('Compendium Item UUID whose ChoiceSet choices to list; reads only, no Actor'),
    })
    .refine((a) => (a.actorUuid === undefined) === (a.listChoices !== undefined), {
      message: 'Give exactly one of actorUuid and listChoices',
    })
    .refine((a) => a.listChoices === undefined || a.changes === undefined, {
      message: 'changes cannot be combined with listChoices',
    }),
  output: characterBuildOutput,
});
