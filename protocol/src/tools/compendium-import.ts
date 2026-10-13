import { z } from 'zod';
import { defineTool } from './define.js';

export const compendiumImport = defineTool({
  name: 'compendium_import',
  minRole: 'gm',
  category: 'write',
  handledBy: 'module',
  description:
    'Import one supported compendium entry as a fresh world document after approval. With actorUuid, embed one Item entry in that owned world Actor instead; overrides are applied by the game system.',
  input: z
    .strictObject({
      uuid: z.string().min(1).max(500).describe('Canonical document UUID'),
      folder: z.string().min(1).max(256).optional().describe('Existing matching world folder ID'),
      actorUuid: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe('Embed the Item entry in this owned world Actor instead of a world import'),
      overrides: z
        .strictObject({
          quantity: z.number().int().min(1).max(9999).optional().describe('Item quantity'),
          equipped: z.boolean().optional().describe('Carry the item equipped or not'),
          slot: z.string().min(1).max(100).optional().describe('Feat slot ID on the Actor'),
        })
        .optional()
        .describe('System-translated settings for the embedded Item; requires actorUuid'),
      choices: z
        .array(
          z.strictObject({
            flag: z
              .string()
              .min(1)
              .max(64)
              .describe('ChoiceSet flag (see character_build listChoices)'),
            itemUuid: z
              .string()
              .min(1)
              .max(500)
              .optional()
              .describe('Item that carries the choice; needed when a flag appears on two items'),
            value: z.string().min(1).max(500).describe('Exact option value (numbers as text)'),
          }),
        )
        .max(64)
        .optional()
        .describe(
          'Answers to ChoiceSet prompts of the embedded Item and its grants; requires actorUuid',
        ),
      onUnanswered: z
        .enum(['reject', 'ignore'])
        .optional()
        .describe(
          'What to do with a ChoiceSet that has no answer: reject the call (default) or create it with the rule ignored and report it',
        ),
    })
    .refine((a) => a.actorUuid === undefined || a.folder === undefined, {
      message: 'folder cannot be combined with actorUuid',
    })
    .refine((a) => a.overrides === undefined || a.actorUuid !== undefined, {
      message: 'overrides require actorUuid',
    })
    .refine(
      (a) => (a.choices === undefined && a.onUnanswered === undefined) || a.actorUuid !== undefined,
      { message: 'choices and onUnanswered require actorUuid' },
    )
    .refine(
      (a) => {
        const seen = new Set<string>();
        for (const c of a.choices ?? []) {
          const key = `${c.flag}\u0000${c.itemUuid ?? ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
        }
        // A flag given both with and without itemUuid, or twice without, is ambiguous.
        const bare = new Set(
          (a.choices ?? []).filter((c) => c.itemUuid === undefined).map((c) => c.flag),
        );
        return (a.choices ?? []).every((c) => c.itemUuid === undefined || !bare.has(c.flag));
      },
      { message: 'choices contain a duplicate or ambiguous flag; give itemUuid for each' },
    ),
  output: z.strictObject({
    uuid: z.string().min(1).max(500).describe('Canonical document UUID (the primary created one)'),
    created: z
      .array(z.string().min(1).max(500))
      .max(50)
      .optional()
      .describe('Every document created, including system grants'),
    choiceReport: z
      .array(
        z.strictObject({
          flag: z.string().max(64).describe('ChoiceSet flag'),
          itemUuid: z.string().max(500).optional().describe('Item that carries the choice'),
          status: z.enum(['answered', 'unanswered', 'rejected', 'unsupported']).describe('Outcome'),
        }),
      )
      .max(64)
      .optional()
      .describe('Outcome of each ChoiceSet seen while creating'),
    incomplete: z
      .boolean()
      .optional()
      .describe('True when some ChoiceSet was left unanswered, rejected or unsupported'),
  }),
});
