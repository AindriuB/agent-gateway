import { defineTool } from '@agent-gateway/protocol';
import { z } from 'zod';

const output = z.strictObject({ accepted: z.boolean().describe('Whether the no-op fixture ran.') });
export const fixtures = [
  defineTool({
    name: 'document_update',
    category: 'write',
    minRole: 'gm',
    handledBy: 'module',
    description: 'Approval UI fixture only: previews an update but never writes a document.',
    input: z.strictObject({
      uuid: z.string().describe('Existing fixture document UUID.'),
      update: z.string().describe('Proposed update as a JSON string, never applied.'),
    }),
    output,
  }),
  defineTool({
    name: 'fixture_review',
    category: 'write',
    minRole: 'gm',
    handledBy: 'module',
    description: 'Approval UI fixture only: escaped third-party provenance and arguments.',
    input: z.strictObject({ html: z.string().describe('Untrusted text to show safely.') }),
    output,
  }),
  defineTool({
    name: 'fixture_code',
    category: 'code',
    minRole: 'gm',
    handledBy: 'module',
    description: 'Approval UI fixture only: displays source and never evaluates it.',
    input: z.strictObject({
      source: z.string().describe('Full source to review, never executed.'),
    }),
    output,
  }),
];
