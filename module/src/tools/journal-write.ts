/* eslint-disable @typescript-eslint/no-explicit-any */
import { journalWrite } from '@agent-gateway/protocol';
import { isAuditDocument } from '../audit/guard.js';
import type { OpHandler } from '../ops/types.js';
import {
  defineWriteHandler,
  forbid,
  markdownHtml,
  owns,
  trustedUser,
  type WriteContext,
} from './_write.js';

declare const fromUuid: (uuid: string) => Promise<any>;

// Serialization protects only this browser instance, not other browsers or manual edits.
const turns = new Map<string, Promise<void>>();
const MAX_PENDING_APPENDS = 64;
const MAX_PAGE_CHARS = 100000;
let pending = 0;
type Args = ReturnType<typeof journalWrite.input.parse>;

async function resolve(args: Args): Promise<{ journal: any; page: any }> {
  const journal = await fromUuid(args.journalUuid);
  const page = args.pageUuid ? await fromUuid(args.pageUuid) : undefined;
  return { journal, page };
}
function check(
  ctx: WriteContext,
  args: Args,
  journal: any,
  page: any,
  canonicalJournal?: string,
  canonicalPage?: string,
): void {
  const user = trustedUser(ctx);
  if (
    journal?.documentName !== 'JournalEntry' ||
    journal.pack ||
    (canonicalJournal && journal.uuid !== canonicalJournal) ||
    !owns(journal, user) ||
    isAuditDocument(journal)
  )
    forbid();
  if (
    args.pageUuid &&
    (page?.documentName !== 'JournalEntryPage' ||
      page.pack ||
      page.parent?.uuid !== journal.uuid ||
      page.parent?.documentName !== 'JournalEntry' ||
      (canonicalPage && page.uuid !== canonicalPage) ||
      page.type !== 'text' ||
      page.text?.format !== 1 ||
      typeof page.text.content !== 'string' ||
      !owns(page, user) ||
      !owns(page.parent, user) ||
      isAuditDocument(page))
  )
    forbid();
}

const write = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = journalWrite.input.parse(ctx.args);
    const html = markdownHtml(args.markdown);
    let { journal, page } = await resolve(args);
    check(ctx, args, journal, page);
    const journalUuid = journal.uuid;
    if (!args.pageUuid) {
      await ctx.intendCreate(journal);
      ({ journal } = await resolve(args));
      check(ctx, args, journal, undefined, journalUuid);
      const pages = await journal.createEmbeddedDocuments(
        'JournalEntryPage',
        [{ name: args.title, type: 'text', text: { format: 1, content: html } }],
        ctx.callOptions,
      );
      const made = pages?.[0];
      if (typeof made?.uuid !== 'string' || made.parent?.uuid !== journal.uuid)
        throw new Error('Journal creation returned no canonical page');
      await ctx.created(made.uuid, journal);
      return {
        text: `Journal page created: ${made.uuid}`,
        structured: { pageUuid: made.uuid, created: true },
      };
    }
    const uuid = page.uuid;
    await ctx.snapshot(uuid);
    // The snapshot may await a GM witness. Re-resolve and recheck immediately before replacement.
    ({ journal, page } = await resolve(args));
    check(ctx, args, journal, page, journalUuid, uuid);
    if (page.text.content.length + html.length + 1 > MAX_PAGE_CHARS)
      forbid('Journal page exceeds the append size limit');
    await page.update({ 'text.content': `${page.text.content}\n${html}` }, ctx.callOptions);
    return {
      text: `Journal page appended: ${uuid}`,
      structured: { pageUuid: uuid, created: false },
    };
  },
});

/** Acquire canonical identity before the complete fresh-read/snapshot/update turn. */
export const journalWriteHandler: OpHandler = async (ctx) => {
  const args = journalWrite.input.parse(ctx.args);
  if (!args.pageUuid) return write(ctx);
  if (pending >= MAX_PENDING_APPENDS)
    return { error: { code: 'FORBIDDEN', message: 'Too many pending journal appends; try again' } };
  pending++;
  try {
    const identity = await fromUuid(args.pageUuid);
    if (typeof identity?.uuid !== 'string' || !identity.uuid)
      return { error: { code: 'FORBIDDEN', message: 'An owned supported world page is required' } };
    const uuid = identity.uuid;
    const previous = turns.get(uuid) ?? Promise.resolve();
    let release!: () => void;
    const turn = new Promise<void>((done) => {
      release = done;
    });
    const tail = previous.then(() => turn);
    turns.set(uuid, tail);
    await previous;
    try {
      // A caller alias cannot change which canonical page this turn protects.
      return await write({ ...ctx, args: { ...args, pageUuid: uuid } });
    } finally {
      release();
      if (turns.get(uuid) === tail) turns.delete(uuid);
    }
  } finally {
    pending--;
  }
};
