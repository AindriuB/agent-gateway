import { leakMatchers, messageIdFromUuid } from '../fixtures/manifest.js';
import { FIXTURE } from '../fixtures/spec.js';
import { requireUuids, type Context } from '../lib/context.js';
import type { CallResult } from '../lib/gateway.js';
import { LeakChecker } from '../lib/leak.js';
import type { MultiGateway } from './gateway.js';

export const ISOLATION_TOOLS = ['world_info', 'document_search', 'document_get', 'chat_read'];

/** A leak checker with the same matchers 12a's PlayerCaller uses. */
export function leakCheckerFor(ctx: Context): LeakChecker {
  const messageId = messageIdFromUuid(requireUuids(ctx).blindRoll);
  if (!messageId) throw new Error('blind roll message id missing; run npm run test:e2e:seed');
  return new LeakChecker(leakMatchers({ total: ctx.fixtures.blindRollTotal, messageId }));
}

/**
 * world_info, document_search, document_get (the public fixture entry, visible to everyone) and
 * chat_read: exactly four calls, one frame each on the bound user's link.
 */
export async function readFourTools(
  gw: MultiGateway,
  scan?: LeakChecker,
): Promise<Record<string, CallResult>> {
  const call = async (name: string, args: Record<string, unknown>): Promise<CallResult> => {
    const r = await gw.call(name, args);
    scan?.check(name, args, r.raw);
    return r;
  };
  const out: Record<string, CallResult> = {};
  out.world_info = await call('world_info', {});
  out.document_search = await call('document_search', {
    type: 'JournalEntry',
    query: FIXTURE.names.publicEntry,
  });
  const uuid = (out.document_search.structured?.results as Array<{ uuid: string }> | undefined)?.[0]
    ?.uuid;
  out.document_get = await call('document_get', { uuid: uuid ?? 'JournalEntry.missing' });
  out.chat_read = await call('chat_read', { limit: 100 });
  return out;
}

/** Valid arguments for each tool the ambiguity suite calls. */
export const AMBIGUITY_CALLS: Array<[string, Record<string, unknown>]> = [
  ['world_info', {}],
  ['document_search', { type: 'JournalEntry', query: 'ag-test' }],
  ['document_get', { uuid: 'JournalEntry.none' }],
  ['compendium_search', { query: 'a' }],
  ['compendium_get', { uuid: 'Compendium.pf2e.journals.JournalEntry.none' }],
  ['chat_read', { limit: 10 }],
];
