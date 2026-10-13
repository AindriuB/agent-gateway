import { z } from 'zod';
import { defineTool } from './define.js';

const attribute = z.string().min(1).max(32);
export const characterBuildOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
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
    'Read character-build state of an owned world Actor (boosts, key attribute, skill ranks, feat slots), or apply a bounded batch of build changes under write policy and approval. Supported on pf2e only.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
    changes: z
      .array(characterBuildChange)
      .max(32)
      .optional()
      .describe('Optional build changes requiring write policy and approval'),
  }),
  output: characterBuildOutput,
});
