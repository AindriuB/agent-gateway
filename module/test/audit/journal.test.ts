/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { AuditRelay } from '../../src/audit/relay.js';
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
        j.pages.contents.push(...data.map((x) => ({ type: x.type, system: x.system })));
        return data;
      };
      journals.push(j);
      return j;
    },
  });
  Object.assign(g.game, {
    user: { id: isGM ? 'gm1' : 'p1', isGM },
    users: {
      contents: USERS,
      get: (id: string) => USERS.find((u) => u.id === id),
      activeGM: USERS[0],
    },
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

  it('a GM client that is not the active GM never creates it either', async () => {
    world(true);
    (globalThis as any).game.users.activeGM = USERS[0];
    (globalThis as any).game.user = { id: 'gm2', isGM: true };
    expect(await ensureAuditJournal()).toBeNull();
    expect(journals).toHaveLength(0);
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

  it('persists the same entry ID for different users while deduplicating each user separately', async () => {
    world(true);
    for (const userId of ['p2', 'p1', 'gm1']) {
      expect(await writeAuditEntry(record({ userId }))).toBe(true);
    }
    for (const userId of ['p2', 'p1', 'gm1']) {
      expect(await writeAuditEntry(record({ userId }))).toBe(false);
    }
    expect(created.map((p) => p.system.userId)).toEqual(['p2', 'p1', 'gm1']);
  });

  it('persists one page across GM tabs with stale caches and acknowledges both relays', async () => {
    const server = new Map<string, any>();
    const requests: any[] = [];
    let release!: () => void;
    const bothRequested = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(async (_name: string, data: any[], options: any) => {
      const sequence = requests.push({ data, options });
      if (requests.length === 2) release();
      await bothRequested;
      const id = options?.keepId ? data[0]._id : `random${sequence}`;
      if (server.has(id)) throw new Error('duplicate embedded document id');
      const page = { ...data[0], id };
      server.set(id, page);
      return [page];
    });
    // Independent caches deliberately never receive the server's creation broadcasts.
    const tabs = [0, 1].map(() => fakeJournal('audit', { createEmbeddedDocuments: create }));
    world(true, tabs, 'audit');
    const g = globalThis as any;
    g.game.journal.get = vi
      .fn()
      .mockReturnValueOnce(tabs[0])
      .mockReturnValueOnce(tabs[1])
      .mockReturnValue(tabs[0]);
    g.getDocumentClass = () => ({ database: { get: async () => [...server.values()] } });
    const emits = [vi.fn(), vi.fn()];
    const relays = emits.map(
      (emit) =>
        new AuditRelay({
          selfId: () => 'gm1',
          isGM: () => true,
          activeGMId: () => 'gm1',
          isUserGM: (id) => id === 'gm1',
          emit,
          write: async (r) => {
            await writeAuditEntry(r);
          },
          onIntent: async () => true,
          setTimer: () => 0,
          clearTimer: () => {},
          now: () => 1000,
        }),
    );
    const msg = { kind: 'audit.entry', record: record() };
    await Promise.all(relays.map((relay) => relay.onMessage(msg, 'p1')));
    expect(requests).toHaveLength(2);
    expect(server.size).toBe(1);
    for (const emit of emits)
      expect(emit).toHaveBeenCalledWith({ kind: 'audit.ack', id: msg.record.entryId }, ['p1']);
    const page = [...server.values()][0];
    expect(page.id).toMatch(/^[A-Za-z0-9]{16}$/);
    page.system.undoneAt = 777;
    expect(await writeAuditEntry(record())).toBe(false);
    expect(server.size).toBe(1);
    expect([...server.values()][0].system.undoneAt).toBe(777);
    // The same entry id from a different authenticated sender is a separate entry.
    expect(await writeAuditEntry(record({ userId: 'p2' }))).toBe(true);
    expect(server.size).toBe(2);
    expect(await writeAuditEntry(record({ entryId: 'entry-other001' }))).toBe(true);
    expect(server.size).toBe(3);
  });

  it('stores a snapshot with hostile keys as inert text', () => {
    const d = pageData(
      record({ targets: [target({ before: { '-=flags': 1, 'a.b': 2 } })] }),
    ) as any;
    expect(typeof d.system.targets[0].before).toBe('string');
  });

  it.each(['missing', 'sender', 'entry', 'type', 'id', 'read failure'])(
    'does not treat a failed creation as persisted when the server read has %s',
    async (failure) => {
      const error = new Error('creation failed');
      let attempted: any;
      const journal = fakeJournal('audit', {
        createEmbeddedDocuments: async (_name: string, data: any[]) => {
          attempted = data[0];
          throw error;
        },
      });
      world(true, [journal], 'audit');
      (globalThis as any).getDocumentClass = () => ({
        database: {
          get: async () => {
            if (failure === 'read failure') throw new Error('read unavailable');
            if (failure === 'missing') return [];
            const page = structuredClone(attempted);
            if (failure === 'sender') page.system.userId = 'p2';
            if (failure === 'entry') page.system.entryId = 'another-entry';
            if (failure === 'type') page.type = 'text';
            if (failure === 'id') page._id = 'another-page';
            return [page];
          },
        },
      });
      await expect(writeAuditEntry(record())).rejects.toBe(error);
    },
  );

  it.each(['empty', 'rejected'])(
    'confirms persistence after a lost creation response (%s)',
    async (response) => {
      let persisted: any;
      const journal = fakeJournal('audit', {
        createEmbeddedDocuments: async (_name: string, data: any[]) => {
          persisted = { ...data[0], system: { ...data[0].system, undoneAt: 777 } };
          if (response === 'rejected') throw new Error('lost response');
          return [];
        },
      });
      world(true, [journal], 'audit');
      (globalThis as any).getDocumentClass = () => ({
        database: { get: async () => [{ ...persisted, _id: 'other-page' }, persisted] },
      });
      expect(await writeAuditEntry(record())).toBe(false);
      expect(persisted.system.undoneAt).toBe(777);
    },
  );

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
    const p = fileURLToPath(new URL('../../../module.json', import.meta.url));
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
