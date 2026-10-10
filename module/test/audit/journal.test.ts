/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAuditJournal,
  pageData,
  verifyRelayedTargets,
  writeAuditEntry,
} from '../../src/audit/journal.js';
import { createAuditModel } from '../../src/audit/model.js';
import { installAudit, getAuditRelay } from '../../src/audit/index.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { record, target } from './fake.js';

let stub: FoundryStub;
let created: any[];
let journals: any[];

function world(isGM: boolean, existing: any[] = []) {
  stub = installFoundry(14);
  const g = globalThis as any;
  created = [];
  journals = existing;
  g.CONST = {
    ...g.CONST,
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  };
  g.getDocumentClass = () => ({
    create: async (d: any) => {
      const j = {
        ...d,
        id: `j${journals.length}`,
        pages: { contents: [] as any[] },
        ownership: d.ownership,
      };
      j.createEmbeddedDocuments = async (_n: string, data: any[]) => {
        created.push(...data);
        j.pages.contents.push(...data.map((x) => ({ system: x.system })));
      };
      journals.push(j);
      return j;
    },
  });
  Object.assign(g.game, {
    user: { id: 'u1', isGM },
    i18n: { localize: (k: string) => (k.endsWith('journalName') ? 'Agent Gateway Audit' : k) },
    journal: {
      get contents() {
        return journals;
      },
    },
  });
}
afterEach(() => {
  stub?.uninstall();
  delete (globalThis as any).getDocumentClass;
});
beforeEach(() => vi.restoreAllMocks());

describe('audit journal', () => {
  it('a GM client creates it once, with default ownership NONE and the identifying flag', async () => {
    world(true);
    const [a, b] = await Promise.all([ensureAuditJournal(), ensureAuditJournal()]);
    expect(journals).toHaveLength(1);
    expect(a).toBe(b);
    expect(journals[0]).toMatchObject({
      name: 'Agent Gateway Audit',
      ownership: { default: 0 },
      flags: { 'agent-gateway': { auditJournal: true } },
    });
    await ensureAuditJournal();
    expect(journals).toHaveLength(1);
  });

  it('a player client never creates it', async () => {
    world(false);
    expect(await ensureAuditJournal()).toBeNull();
    expect(journals).toHaveLength(0);
  });

  it('finds an existing one by its flag, not its name, and warns when its ownership was raised', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    world(true, [
      { id: 'x', name: 'Agent Gateway Audit', flags: {} },
      {
        id: 'y',
        name: 'Renamed',
        flags: { 'agent-gateway': { auditJournal: true } },
        ownership: { default: 2 },
      },
    ]);
    expect((await ensureAuditJournal()).id).toBe('y');
    expect(journals).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  it('writes a record as an audit-subtype page once per entry id', async () => {
    world(true);
    expect(await writeAuditEntry(record({ targets: [target()] }))).toBe(true);
    expect(await writeAuditEntry(record({ targets: [target()] }))).toBe(false);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      type: 'agent-gateway.audit',
      system: { entryId: 'entry-0000001', tool: 'fixture_write', undoneAt: null },
    });
    // The snapshot is stored as text, so no key in it means anything to Foundry's update logic.
    expect(created[0].system.targets[0].before).toBe(JSON.stringify({ name: 'Old' }));
  });

  it('stores a snapshot with hostile keys as inert text', () => {
    const d = pageData(
      record({ targets: [target({ before: { '-=flags': 1, 'a.b': 2 } })] }),
    ) as any;
    expect(typeof d.system.targets[0].before).toBe('string');
  });
});

describe('relayed targets are verified', () => {
  const sender = { id: 'p1' };
  const docs: Record<string, any> = {
    'Actor.mine': { canUserModify: () => true },
    'Actor.theirs': { canUserModify: () => false },
    'Actor.parent': { canUserModify: () => true },
  };
  const lookup = async (u: string) => docs[u] ?? null;

  it('keeps undo only for documents the sender may modify', async () => {
    const r = await verifyRelayedTargets(
      record({ targets: [target({ uuid: 'Actor.mine' }), target({ uuid: 'Actor.theirs' })] }),
      sender,
      lookup,
    );
    expect(r.targets.map((t) => t.undoable)).toEqual([true, false]);
  });

  it('a deleted target needs the parent or the snapshot to show the sender owned it', async () => {
    const r = await verifyRelayedTargets(
      record({
        targets: [
          target({ uuid: 'Actor.parent.Item.i1' }),
          target({ uuid: 'Actor.gone1', before: { ownership: { default: 0 } } }),
          target({ uuid: 'Actor.gone2', before: { ownership: { p1: 3 } } }),
          target({ uuid: 'Actor.gone3', before: { ownership: { p1: 3 } } }),
        ],
      }),
      sender,
      lookup,
    );
    expect(r.targets.map((t) => t.undoable)).toEqual([true, false, true, true]);
  });
});

describe('model and manifest', () => {
  it('module.json declares the audit subtype for JournalEntryPage', () => {
    const p = ['.', '..']
      .map((b) => resolve(process.cwd(), b, 'module.json'))
      .find((f) => {
        try {
          return readFileSync(f, 'utf8').includes('agent-gateway');
        } catch {
          return false;
        }
      })!;
    expect(JSON.parse(readFileSync(p, 'utf8')).documentTypes).toEqual({
      JournalEntryPage: { audit: {} },
    });
  });

  it('the data model defines every audit field', () => {
    stub = installFoundry(14);
    const g = globalThis as any;
    const F = (name: string) =>
      class {
        constructor(public arg?: any) {
          (this as any).kind = name;
        }
      };
    g.foundry.data = {
      fields: Object.fromEntries(
        [
          'StringField',
          'NumberField',
          'BooleanField',
          'ObjectField',
          'ArrayField',
          'SchemaField',
        ].map((n) => [n, F(n)]),
      ),
    };
    g.foundry.abstract = { TypeDataModel: class {} };
    const schema = createAuditModel().defineSchema();
    expect(Object.keys(schema)).toEqual(
      expect.arrayContaining([
        'timestamp',
        'userId',
        'agentId',
        'tool',
        'category',
        'args',
        'targets',
        'result',
      ]),
    );
    const t = schema.targets.arg.arg.fields ?? schema.targets.arg.arg;
    expect(Object.keys(t)).toEqual(expect.arrayContaining(['uuid', 'before', 'afterModifiedTime']));
  });
});

describe('installAudit hooks', () => {
  it('init registers the data model, label and a GM-only menu; ready creates the journal and starts the relay', async () => {
    vi.resetModules();
    stub = installFoundry(14);
    const g = globalThis as any;
    g.foundry.data = {
      fields: new Proxy(
        {},
        {
          get: () =>
            class {
              constructor(public arg?: any) {}
            },
        },
      ),
    };
    g.foundry.abstract = { TypeDataModel: class {} };
    g.CONFIG = { JournalEntryPage: { dataModels: {}, typeLabels: {} } };
    const mod = await import('../../src/audit/index.js');
    mod.installAudit();
    mod.installAudit();
    stub.fire('init');
    expect(g.CONFIG.JournalEntryPage.dataModels['agent-gateway.audit']).toBeTypeOf('function');
    expect(g.CONFIG.JournalEntryPage.typeLabels['agent-gateway.audit']).toBe(
      'AGENT_GATEWAY.Audit.typeLabel',
    );
    const menu = stub.registeredMenus.get('agent-gateway.audit');
    expect(menu.restricted).toBe(true);
    delete g.CONFIG;
  });

  it('is inert outside Foundry (no CONFIG): init does nothing, ready without a user does nothing', () => {
    stub = installFoundry(14);
    installAudit();
    stub.fire('init');
    stub.fire('ready');
    expect(getAuditRelay()).toBeNull();
  });
});
