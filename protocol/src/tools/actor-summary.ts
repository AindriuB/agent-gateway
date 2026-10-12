import { z } from 'zod';
import { defineTool } from './define.js';
export const actorSummaryOutput = z.strictObject({
  actorUuid: z.string().min(1).max(256).describe('Canonical Actor UUID'),
  systemId: z.string().min(1).max(100).describe('Active system ID'),
  name: z.string().max(1000).describe('Actor name'),
  img: z.string().max(2048).describe('Actor image path'),
  type: z.string().max(100).describe('Actor type'),
  attributes: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(100).describe('Attribute key'),
        label: z.string().max(200).describe('Attribute label'),
        value: z.string().max(2000).describe('Display value'),
      }),
    )
    .max(64)
    .describe('System summary attributes'),
});
export type ActorSummaryOutput = z.infer<typeof actorSummaryOutput>;
export const actorSummary = defineTool({
  name: 'actor_summary',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description: 'Read a minimal system-aware summary of an owned world Actor.',
  input: z.strictObject({
    actorUuid: z.string().min(1).max(256).describe('Canonical owned world Actor UUID'),
  }),
  output: actorSummaryOutput,
});
