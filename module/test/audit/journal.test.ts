/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureAuditJournal,
  pageData,
  findAuditJournal,
  registerAuditSettings,
  writeAuditEntry,
} from '../../src/audit/journal.js';
import { createAuditModel } from '../../src/audit/model.js';
import { installAudit, getAuditRelay } from '../../src/audit/index.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { record, target } from './fake.js';

let stub: FoundryStub;
let created: any[];
let journals: any[];

const FLAG = { 'agent-gateway': { auditJournal: true } };
const USERS = [
  { id: 'gm1', isGM: true },
  { id: 'p1', isGM: false },
  { id: 'p2', isGM: false },
];

/** A journal as Foundry would hold it. `sees` lists non-GM users with access. */
const fakeJournal = (id: string, over: any = {}) => ({
  id,
  name: 'Agent Gateway Audit',
  flags: FLAG,
  ownership: { default: 0 },
  _stats: { createdBy: 'gm1' },
  testUserPermission: (u: any) => (over.sees ?? []).includes(u.id),
  pages: { contents: [] as any[] },
  ...over,
});

function world(isGM: boolean, existing: any[] = [], storedId = '') {
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
      const j: any = fakeJournal(`j${journals.length + 1}`, { ...d, _stats: { createdBy: 'gm1' } });
      j.createEmbeddedDocuments = async (_n: string, data: any[]) => {
        created.push(...data);
        j.pages.contents.push(...data.map((x) => ({ system: x.system })));
      };
      journals.push(j);
      return j;
    },
  });
  Object.assign(g.game, {
    user: { id: isGM ? 'gm1' : 'p1', isGM },
    users: { contents: USERS, get: (id: string) => USERS.find((u) => u.id === id) },
    i18n: { localize: (k: string) => (k.endsWith('journalName') ? 'Agent Gateway Audit' : k) },
    journal: {
      get contents() {
        return journals;
      },
      get: (id: string) => journals.find((j) => j.id === id),
    },
  });
  registerAuditSettings();
  if (storedId) g.game.settings.set('agent-gateway', 'auditJournalId', storedId);
}
afterEach(() => {
  stub?.uninstall();
  delete (globalThis as any).getDocumentClass;
});
beforeEach(() => vi.restoreAllMocks());

describe('audit journal', () => {
  it('a GM client creates it once, default ownership NONE, flagged, and records its id in a world setting', async () => {
    world(true);
    const [a, b] = await Promise.all([ensureAuditJournal(), ensureAuditJournal()]);
    expect(journals).toHaveLength(1);
    expect(a).toBe(b);
    expect(journals[0]).toMatchObject({
      name: 'Agent Gateway Audit',
      ownership: { default: 0 },
      flags: { 'agent-gateway': { auditJournal: true } },
    });
    const reg = stub.registeredSettings.get('agent-gateway.auditJournalId')!;
    expect(reg).toMatchObject({ scope: 'world', config: false });
    expect((globalThis as any).game.settings.get('agent-gateway', 'auditJournalId')).toBe(
      journals[0].id,
    );
    await ensureAuditJournal();
    expect(journals).toHaveLength(1);
  });

  it('a player client never creates it', async () => {
    world(false);
    expect(await ensureAuditJournal()).toBeNull();
    expect(journals).toHaveLength(0);
  });

  it('a flagged journal planted by a player with a low id is ignored; the real one is created and used', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const forged = fakeJournal('0000aaaa', { _stats: { createdBy: 'p1' } });
    world(true, [forged]);
    const real = await ensureAuditJournal();
    expect(real.id).not.toBe('0000aaaa');
    expect(journals).toHaveLength(2);
    expect(findAuditJournal()).toBe(real);
    await writeAuditEntry(record());
    expect(forged.pages.contents).toHaveLength(0);
    expect(real.pages.contents).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a flagged journal is not trusted unless it is the stored id, GM-created and closed to every non-GM', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const bad of [
      fakeJournal('x1', { _stats: { createdBy: 'p1' } }),
      fakeJournal('x1', { _stats: {} }),
      fakeJournal('x1', { sees: ['p2'] }),
      fakeJournal('x1', { ownership: { default: 2 } }),
      fakeJournal('x1', { flags: {} }),
    ]) {
      world(true, [bad], 'x1');
      expect(findAuditJournal()).toBeNull();
      // Never silently replaced: the named journal exists, so no second one is made.
      expect(await ensureAuditJournal()).toBeNull();
      expect(journals).toHaveLength(1);
      stub.uninstall();
    }
    expect(warn).toHaveBeenCalled();
    world(true, [fakeJournal('x1')], 'x1');
    expect(findAuditJournal()?.id).toBe('x1');
    // A journal that is flagged but not the stored id is never used even when it looks fine.
    world(true, [fakeJournal('x1'), fakeJournal('x2')], 'x1');
    expect(findAuditJournal()?.id).toBe('x1');
    world(true, [fakeJournal('x2')], '');
    expect(findAuditJournal()).toBeNull();
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

  it('stores the targets it is given: a sanitised relayed record is view-only, a witnessed one keeps its GM-captured snapshot', () => {
    const viewOnly = pageData(
      record({ relayed: true, targets: [target({ undoable: false, before: null })] }),
    ) as any;
    expect(viewOnly.system.targets[0]).toMatchObject({ before: '', undoable: false });
    const witnessed = pageData(
      record({ relayed: true, targets: [target({ changedPaths: ['name'] })] }),
    ) as any;
    expect(witnessed.system.targets[0]).toMatchObject({ undoable: true, changedPaths: ['name'] });
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
