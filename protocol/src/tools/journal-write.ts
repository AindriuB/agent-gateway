import { z } from 'zod';
import { defineTool } from './define.js';

export const journalWrite = defineTool({
  name: 'journal_write',
  minRole: 'player',
  category: 'write',
  handledBy: 'module',
  description:
    'Create a text page in an owned journal or append safe Markdown to an owned HTML text page. Appends serialize within this browser only. Requires owner approval by default.',
  input: z.strictObject({
    journalUuid: z.string().min(1).max(256).describe('UUID of an owned world journal'),
    pageUuid: z
      .string()
      .min(1)
      .max(256)
      .optional()
      .describe('Existing owned HTML text page in that journal; omit to create a page'),
    title: z
      .string()
      .min(1)
      .max(200)
      .describe('New page title; existing page titles remain unchanged'),
    markdown: z
      .string()
      .min(1)
      .max(4000)
      .describe('Markdown to create or append, up to 4000 characters; raw HTML is escaped'),
  }),
  output: z.strictObject({
    pageUuid: z.string().max(256).describe('UUID of the created or updated page'),
    created: z.boolean().describe('True when a new page was created'),
  }),
});
