// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineTool } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { listEntries } from '../../src/apps/audit/index.js';
import { assertNotAudit, AuditProtectedError, isAuditDocument } from '../../src/audit/guard.js';
import { sanitiseTarget } from '../../src/audit/record.js';
import { createAuditStage } from '../../src/audit/stage.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { createDispatcher } from '../../src/ops/dispatch.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { makeStore, writable } from './fake.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const FLAG = { 'agent-gateway': { auditJournal: true } };
const auditJournal = () => ({ id: 'aj', flags: FLAG, documentName: 'JournalEntry' });
const page = (parent: any) => ({ id: 'pg', parent, documentName: 'JournalEntryPage' });

describe('write-side guard', () => {
  it('recognises the audit journal and anything inside it, trusted or not', () => {
    const j = auditJournal();
    expect(isAuditDocument(j)).toBe(true);
    expect(isAuditDocument(page(j))).toBe(true);
    expect(isAuditDocument({ id: 'x', flags: {} })).toBe(false);
    expect(isAuditDocument(null)).toBe(false);
    expect(() => assertNotAudit(page(j))).toThrow(AuditProtectedError);
    expect(() => assertNotAudit({ flags: {} })).not.toThrow();
  });

  it('a write handler cannot snapshot the audit log, so a tool call that targets it fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = makeStore();
    const doc = store.add(writable('JournalEntry.aj', {}, 1, store));
    doc.flags = FLAG;
    const records: AuditRecord[] = [];
    const tool = defineTool({
      name: 'fixture_write',
      minRole: 'gm',
      category: 'write',
      handledBy: 'module',
      description: 'x',
      input: z.strictObject({}),
      output: z.strictObject({}),
    });
    let mutated = false;
    const d = createDispatcher({
      tools: [tool],
      handlers: {
        fixture_write: async (ctx) => {
          await ctx.snapshot?.('JournalEntry.aj');
          mutated = true;
          return { text: 'x', structured: {} };
        },
      },
      stages: [
        createAuditStage({
          isGM: () => true,
          categoryOf: () => 'write',
          fromUuid: store.fromUuid,
          submit: async (r) => void records.push(r),
        }),
      ],
    });
    const r = await d(
      {
        tool: 'fixture_write',
        args: {},
        agent: { id: 'a', ownerUserId: 'g', headless: false },
        sessionId: 's',
      },
      { id: 'g', isGM: true },
    );
    expect(r).toMatchObject({ error: { code: 'INTERNAL' } });
    expect(mutated).toBe(false);
  });
});

describe('targets', () => {
  it('a compendium target is never undoable, even from a handler that says so', () => {
    const t = sanitiseTarget(
      { uuid: 'Compendium.w.p.Actor.x', existed: true, undoable: true, before: { a: 1 } },
      { chars: 1e6 },
    );
    expect(t).toMatchObject({ undoable: false });
  });
});

describe('the audit app list', () => {
  it('shows pages of the trusted journal only, never those of a forged flagged one', () => {
    stub = installFoundry(14, { worldSettingWriter: () => 'gm1' });
    const g = globalThis as any;
    const users = [{ id: 'gm1', isGM: true }];
    const mk = (id: string, createdBy: string, tool: string) => ({
      id,
      flags: FLAG,
      ownership: { default: 0 },
      _stats: { lastModifiedBy: createdBy },
      testUserPermission: () => false,
      pages: {
        contents: [{ id: `${id}p`, type: 'agent-gateway.audit', system: { tool, targets: [] } }],
      },
    });
    const journals = [mk('0000aaaa', 'p1', 'FORGED_ENTRY'), mk('real', 'gm1', 'REAL_ENTRY')];
    Object.assign(g.game, {
      users: { contents: users, get: (id: string) => users.find((u) => u.id === id) },
      journal: { contents: journals, get: (id: string) => journals.find((j) => j.id === id) },
    });
    g.game.settings.register('agent-gateway', 'auditJournalId', {
      scope: 'world',
      type: String,
      default: '',
    });
    g.game.settings.set('agent-gateway', 'auditJournalId', 'real');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(listEntries().map((e) => e.tool)).toEqual(['REAL_ENTRY']);
    g.game.settings.set('agent-gateway', 'auditJournalId', '0000aaaa');
    stub.worldSettings.get('agent-gateway.auditJournalId')._stats.lastModifiedBy = 'p1';
    expect(listEntries()).toEqual([]);
  });
});
