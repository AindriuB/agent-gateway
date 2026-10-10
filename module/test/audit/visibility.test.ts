// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { DispatchResult } from '../../src/ops/types.js';
import { clearDocumentCache } from '../../src/tools/document-get.js';
import type { FoundryStub } from '../stubs/foundry.js';
import { fakeDoc, gmUser, playerUser, setupWorld } from '../stubs/world.js';

let stub: FoundryStub;
afterEach(() => {
  stub?.uninstall();
  clearDocumentCache();
});

const MARK = 'AUDIT-SECRET-MARKER-7731';
const agent = { id: 'a1', ownerUserId: 'p1', headless: false };
const call = (tool: string, args: unknown, user: any): Promise<DispatchResult> =>
  dispatch({ tool, args, agent, sessionId: 's' }, user);
const json = (r: DispatchResult) => JSON.stringify(r);

/** The audit journal as the module creates it: ownership default NONE, so nobody but GMs observes it. */
function world(observers: string[] = [], flagged = true) {
  const page = fakeDoc({
    id: 'pg1',
    name: `2026-10-10 fixture_write ${MARK}`,
    documentName: 'JournalEntryPage',
    type: 'agent-gateway.audit',
    observers,
    data: { system: { tool: 'fixture_write', args: `{"note":"${MARK}"}`, result: MARK } },
  });
  const journal = fakeDoc({
    id: 'aj1',
    name: `Agent Gateway Audit ${MARK}`,
    documentName: 'JournalEntry',
    observers,
    embedded: { pages: [page] },
  });
  if (flagged) journal.flags = { 'agent-gateway': { auditJournal: true } };
  stub = setupWorld({ docs: { journal: [journal] } });
  return { journal, page };
}

describe('the audit journal is GM-only through our own read tools', () => {
  it('document_search never lists it for a player, by type, query or folder', async () => {
    world();
    for (const args of [
      { type: 'JournalEntry' },
      { type: 'JournalEntry', query: 'audit' },
      { type: 'JournalEntry', query: MARK },
    ]) {
      const r = await call('document_search', args, playerUser);
      expect(json(r)).not.toContain(MARK);
      expect(json(r)).not.toContain('Agent Gateway Audit');
      expect(r).toMatchObject({ structured: { total: 0, results: [] } });
    }
  });

  it('document_get is "not found" for the journal and for any entry page, as for a missing document', async () => {
    world();
    const missing = json(await call('document_get', { uuid: 'JournalEntry.nope' }, playerUser));
    for (const uuid of ['JournalEntry.aj1', 'JournalEntry.aj1.JournalEntryPage.pg1']) {
      const r = await call('document_get', { uuid }, playerUser);
      expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      expect(json(r)).not.toContain(MARK);
      expect(json(r).replace(uuid, 'X')).toBe(missing.replace('JournalEntry.nope', 'X'));
    }
  });

  it('a GM can read it, so the player result above is the ownership check and not a broken fixture', async () => {
    world();
    const s = await call('document_search', { type: 'JournalEntry' }, gmUser);
    expect(json(s)).toContain('Agent Gateway Audit');
    const g = await call('document_get', { uuid: 'JournalEntry.aj1.JournalEntryPage.pg1' }, gmUser);
    expect(json(g)).toContain(MARK);
  });

  it('stays hidden from players even if the default ownership is raised by mistake', async () => {
    world(['p1']);
    for (const q of [{ type: 'JournalEntry', query: 'audit' }]) {
      expect(json(await call('document_search', q, playerUser))).not.toContain(MARK);
    }
    for (const uuid of ['JournalEntry.aj1', 'JournalEntry.aj1.JournalEntryPage.pg1']) {
      const r = await call('document_get', { uuid }, playerUser);
      expect(r).toMatchObject({ error: { code: 'INVALID_ARGS' } });
      expect(json(r)).not.toContain(MARK);
    }
  });

  it('control: an unflagged journal with raised ownership IS readable (the hiding is not vacuous)', async () => {
    world(['p1'], false);
    const r = await call('document_search', { type: 'JournalEntry', query: 'audit' }, playerUser);
    expect(json(r)).toContain('Agent Gateway Audit');
  });
});
