// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatPost, journalWrite, rollFormula, TOOLS } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { createApprovalStage } from '../../../src/approvals/stage.js';
import type { AuditRecord } from '../../../src/audit/types.js';
import {
  chatPostHandler,
  markAgentChat,
  protectAgentMarker,
} from '../../../src/tools/chat-post.js';
import { rollFormulaHandler, checkRollFormula } from '../../../src/tools/roll-formula.js';
import { journalWriteHandler } from '../../../src/tools/journal-write.js';
import { defineWriteHandler, markdownHtml } from '../../../src/tools/_write.js';
import { Hub, settle } from '../../stubs/approvals.js';
import { installFoundry } from '../../stubs/foundry.js';

const g = globalThis as any;
const defs = [chatPost, rollFormula, journalWrite];
const handlers = {
  chat_post: chatPostHandler,
  roll_formula: rollFormulaHandler,
  journal_write: journalWriteHandler,
};
const user = { id: 'p1', isGM: false };
const gm = { id: 'gm', isGM: true };
const argsPage = {
  journalUuid: 'JournalEntry.j',
  pageUuid: 'JournalEntry.j.JournalEntryPage.p',
  title: 'Test page',
  markdown: '**new**',
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let stub: ReturnType<typeof installFoundry>;
let docs: Map<string, any>;
let journal: any;
let page: any;
let actor: any;
let created: any[];
let seq: number;
const ctx = (tool: string, args: unknown, who = user): any => ({
  tool,
  args,
  user: who,
  agent: { id: 'agent', ownerUserId: who.id, headless: false },
  sessionId: 'session',
  snapshot: vi.fn(async () => {}),
  intendCreate: vi.fn(async () => {}),
  created: vi.fn(async () => {}),
  callOptions: { agentGateway: { callId: 'call-123' } },
});
function doc(uuid: string, kind: string, fields: any = {}): any {
  const d: any = {
    uuid,
    id: uuid.split('.').at(-1),
    documentName: kind,
    flags: {},
    owners: new Set(['p1']),
    _stats: { modifiedTime: 1 },
    ...fields,
  };
  d.testUserPermission = vi.fn((u: any) => u.isGM || d.owners.has(u.id));
  d.toObject = () => ({
    _id: d.id,
    name: d.name,
    type: d.type,
    text: d.text ? { ...d.text } : undefined,
    flags: d.flags,
    _stats: { ...d._stats },
  });
  d.update = vi.fn(async (change: any) => {
    if (change['text.content'] !== undefined) d.text.content = change['text.content'];
    d._stats.modifiedTime++;
    return d;
  });
  docs.set(uuid, d);
  return d;
}
beforeEach(() => {
  stub = installFoundry(14);
  docs = new Map();
  created = [];
  seq = 0;
  g.game.user = user;
  const users = [user, gm, { id: 'p2', isGM: false, name: 'Player2' }].map((u) => ({
    name: u.id,
    ...u,
  }));
  g.game.users = { get: (id: string) => users.find((u) => u.id === id), contents: users };
  journal = doc('JournalEntry.j', 'JournalEntry', { name: 'Owned journal' });
  page = doc(argsPage.pageUuid, 'JournalEntryPage', {
    parent: journal,
    type: 'text',
    text: { format: 1, content: '<p>old</p>' },
  });
  actor = doc('Actor.a', 'Actor', { name: 'Owned actor' });
  journal.createEmbeddedDocuments = vi.fn(async (_kind: string, entries: any[], options: any) =>
    entries.map((entry) => {
      const made = doc(`JournalEntry.j.JournalEntryPage.new${++seq}`, 'JournalEntryPage', {
        ...entry,
        parent: journal,
      });
      created.push({ made, data: entry, options });
      return made;
    }),
  );
  g.fromUuid = vi.fn(async (uuid: string) => docs.get(uuid));
  g.ChatMessage = {
    create: vi.fn(async (data: any, options: any) => {
      const made = doc(`ChatMessage.m${++seq}`, 'ChatMessage', data);
      created.push({ made, data, options });
      return made;
    }),
  };
  g.Roll = class {
    total = 9;
    terms = [{ formula: '2d6', total: 7 }, { operator: '+' }, { number: 2, total: 2 }];
    async evaluate() {
      return this;
    }
  };
  g.CONST.CHAT_MESSAGE_STYLES = { ROLL: 5 };
});
afterEach(() => {
  stub.uninstall();
  delete g.ChatMessage;
  delete g.Roll;
});

describe('bounded protocol and shared write helper', () => {
  it('registers all three tools as player writes and enforces strict input bounds', () => {
    for (const def of defs)
      expect(TOOLS.find((x) => x.name === def.name)).toMatchObject({
        minRole: 'player',
        category: 'write',
      });
    expect(chatPost.input.safeParse({ content: 'x'.repeat(4001) }).success).toBe(false);
    expect(chatPost.input.safeParse({ content: 'x', flags: { ai: false } }).success).toBe(false);
    expect(journalWrite.input.safeParse({ ...argsPage, markdown: 'x'.repeat(4001) }).success).toBe(
      false,
    );
    expect(rollFormula.input.parse({ formula: '1d6' }).toChat).toBe(true);
  });
  it('awaits target snapshots before running and uses first snapshots through the audit stage', async () => {
    const gate = deferred();
    const run = vi.fn(() => ({ text: 'ok', structured: {} }));
    const c = ctx('journal_write', argsPage);
    c.snapshot = vi.fn(() => gate.promise);
    const result = defineWriteHandler({ targets: () => [page.uuid], run })(c);
    await settle();
    expect(c.snapshot).toHaveBeenCalledWith(page.uuid);
    expect(run).not.toHaveBeenCalled();
    gate.resolve();
    await result;
    expect(run).toHaveBeenCalledOnce();
  });
  it.each(['snapshot', 'intendCreate', 'created', 'callOptions'])(
    'fails every handler closed without %s',
    async (missing) => {
      for (const [tool, args] of [
        ['chat_post', { content: 'test' }],
        ['roll_formula', { formula: '1d6' }],
        ['journal_write', argsPage],
      ] as const) {
        const c = ctx(tool, args);
        delete c[missing];
        expect(await handlers[tool](c)).toMatchObject({ error: { code: 'INTERNAL' } });
      }
      expect(created).toHaveLength(0);
      expect(page.update).not.toHaveBeenCalled();
    },
  );
  it('does not trust caller identity if the current user is missing or differs', async () => {
    g.game.user = gm;
    expect(await chatPostHandler(ctx('chat_post', { content: 'test' }))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(created).toHaveLength(0);
  });
});

describe('chat safety and immutable native markers', () => {
  it('creates marked escaped Markdown chat with fresh owned actor and exact whisper recipients', async () => {
    const c = ctx('chat_post', {
      content: '**hello** <img src=x onerror=alert(1)> [bad](javascript:alert(1))',
      speakerActorUuid: actor.uuid,
      whisperTo: ['Player2'],
    });
    const result = await chatPostHandler(c);
    expect(result).toMatchObject({ structured: { messageUuid: 'ChatMessage.m1' } });
    expect(created[0].data).toMatchObject({
      flags: { 'agent-gateway': { ai: true } },
      speaker: { actor: 'a', alias: 'Owned actor' },
      whisper: ['p2'],
    });
    expect(created[0].data.content).toContain('<strong>hello</strong>');
    expect(created[0].data.content).not.toContain('<img');
    expect(created[0].data.content).not.toContain('href="javascript:');
    expect(c.intendCreate).toHaveBeenCalledWith();
    expect(c.created).toHaveBeenCalledWith('ChatMessage.m1');
    expect(c.snapshot).not.toHaveBeenCalled();
    expect(created[0].options).toBe(c.callOptions);
  });
  it('rejects actor ownership removed while intendCreate awaits', async () => {
    const c = ctx('chat_post', { content: 'test', speakerActorUuid: actor.uuid });
    c.intendCreate.mockImplementation(async () => {
      actor.owners.clear();
    });
    expect(await chatPostHandler(c)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(created).toHaveLength(0);
  });
  it('rejects ambiguous/unknown whispers and actor compendiums', async () => {
    expect(
      await chatPostHandler(ctx('chat_post', { content: 'x', whisperTo: ['missing'] })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    g.game.users.contents.push({ id: 'p3', name: 'Player2' });
    expect(
      await chatPostHandler(ctx('chat_post', { content: 'x', whisperTo: ['Player2'] })),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    actor.pack = 'world.actors';
    expect(
      await chatPostHandler(ctx('chat_post', { content: 'x', speakerActorUuid: actor.uuid })),
    ).toMatchObject({ error: { code: 'FORBIDDEN' } });
  });
  it.each([13, 14])('renders one visible AI marker for native v%s hook roots', (generation) => {
    const root = document.createElement('article');
    root.innerHTML = '<header class="message-header"></header>';
    const html = generation === 13 ? { 0: root } : root;
    const message = { flags: { 'agent-gateway': { ai: true } } };
    markAgentChat(message, html);
    markAgentChat(message, root);
    expect(root.querySelectorAll('.agent-gateway-ai-marker')).toHaveLength(1);
    expect(root.querySelector('.agent-gateway-ai-marker')?.textContent).toBe('AI');
    const unmarked = document.createElement('article');
    markAgentChat({ flags: {} }, unmarked);
    expect(unmarked.children).toHaveLength(0);
  });
  it.each([
    { 'flags.agent-gateway.ai': false },
    { 'flags.agent-gateway.-=ai': null },
    { 'flags.-=agent-gateway': null },
    { '-=flags': null },
    { flags: null },
    { flags: [] },
    { 'flags.agent-gateway': [] },
    { flags: { 'agent-gateway': [] } },
    { flags: { '-=agent-gateway': null } },
    { flags: { 'agent-gateway': { ai: false } } },
    { flags: { 'agent-gateway': { '-=ai': null } } },
    { 'flags.agent-gateway': { ai: true, '-=ai': null } },
    { '-=flags.x': null },
    { 'flags.-=agent-gateway.x': null },
  ])('refuses native flag erasure %j', (change) => {
    expect(protectAgentMarker({ flags: { 'agent-gateway': { ai: true } } }, change)).toBe(false);
  });
  it('refuses replacement flag removal and missing current user', async () => {
    const message = { flags: { 'agent-gateway': { ai: true } } };
    expect(protectAgentMarker(message, { flags: {} }, { recursive: false })).toBe(false);
    delete g.game.user;
    expect(await chatPostHandler(ctx('chat_post', { content: 'test' }))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
  });
  it('performs final actor permission checks at the chat create call site', async () => {
    let checks = 0;
    actor.testUserPermission.mockImplementation(() => {
      if (++checks === 2) queueMicrotask(() => actor.owners.clear());
      return actor.owners.has('p1');
    });
    g.ChatMessage.create.mockImplementation(async () => {
      expect(actor.owners.has('p1')).toBe(true);
      return { uuid: 'ChatMessage.checked' };
    });
    expect(
      await chatPostHandler(ctx('chat_post', { content: 'test', speakerActorUuid: actor.uuid })),
    ).toMatchObject({ structured: { messageUuid: 'ChatMessage.checked' } });
  });
  it('keeps native inline roll syntax inert and bounds marker guard work', () => {
    for (const input of ['[[1000000d6]]', '&#91;&#91;1000000d6]]', String.raw`\[\[1000000d6]]`]) {
      const html = markdownHtml(input);
      const root = document.createElement('div');
      root.innerHTML = html;
      expect(root.textContent).not.toContain('[[');
      expect(root.textContent?.replace(/\u200b/g, '')).toContain('[[1000000d6]]');
      expect(root.textContent).not.toMatch(/\[\[([^\]]+)]]/);
    }
    for (const input of [
      '@Damage[1000000d6]',
      '@Check[type:flat|dc:10]',
      '@UUID[Actor.a]',
      '@Embed[JournalEntry.j]',
      '&#64;Damage[1000000d6]',
      '`@Damage[1000000d6]`',
    ]) {
      const root = document.createElement('div');
      root.innerHTML = markdownHtml(input);
      expect(root.textContent).not.toMatch(/@(?:Damage|Check|UUID|Embed)\[/);
      expect(root.textContent?.replace(/\u200b/g, '')).toContain('@');
    }
    const cyclic: any = {};
    cyclic.loop = cyclic;
    expect(protectAgentMarker({ flags: { 'agent-gateway': { ai: true } } }, cyclic)).toBe(false);
  });
  it('has no marker toggle and escapes hostile Markdown URLs and event handlers', () => {
    expect(
      readFileSync(new NodeURL('../../../src/settings/index.ts', import.meta.url), 'utf8'),
    ).not.toMatch(/(?:aiMarker|hideAI|showAI|disableMarker)/i);
    const html = markdownHtml(
      '<script>alert(1)</script>\n[x](JaVaScRiPt:alert(1))\n<img onerror="alert(1)">\n[x](data:text/html;base64,AAAA)',
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(root.querySelector('script,img,[onerror],a')).toBeNull();
  });
});

describe('bounded native dice evaluation', () => {
  it.each(['1d6', '2d6 + 2', '(1d8 + 2) / 2', 'd20', '-2 + 3', '100d1000', '((((((((1))))))))'])(
    'accepts bounded formula %s',
    (formula) => expect(() => checkRollFormula(formula)).not.toThrow(),
  );
  it.each([
    '1d6!',
    '1d6r1',
    '1d6kh1',
    '@actor.hp',
    'Math.random()',
    '100000d6',
    '50d6+51d6',
    '1d1001',
    '1d1',
    '0d6',
    '1.5d6',
    '999999999999',
    '('.repeat(9) + '1' + ')'.repeat(9),
    '1 +',
    '1e12',
    '1 ** 2',
    '1;alert(1)',
  ])('rejects unsupported/excessive formula %s', async (formula) => {
    const spy = vi.spyOn(g.Roll.prototype, 'evaluate');
    const result = await rollFormulaHandler(ctx('roll_formula', { formula }));
    if (formula) expect(result).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('returns bounded terms and creates an AI roll with correlation options', async () => {
    const c = ctx('roll_formula', { formula: '2d6 + 2', flavor: '<img onerror=alert(1)>' });
    const result = await rollFormulaHandler(c);
    expect(result).toMatchObject({
      structured: {
        total: 9,
        messageUuid: 'ChatMessage.m1',
        terms: [{ formula: '2d6', total: 7 }, { formula: '+' }, { formula: '2', total: 2 }],
      },
    });
    expect(created[0].data.flags['agent-gateway'].ai).toBe(true);
    expect(created[0].data.flavor).toBe('&lt;img onerror=alert(1)&gt;');
    expect(created[0].options).toBe(c.callOptions);
  });
  it('toChat:false still requires audit but declares no mutation or creation', async () => {
    const c = ctx('roll_formula', { formula: '1d6', toChat: false });
    expect(await rollFormulaHandler(c)).toMatchObject({ structured: { total: 9 } });
    expect(created).toHaveLength(0);
    expect(c.snapshot).not.toHaveBeenCalled();
    expect(c.intendCreate).not.toHaveBeenCalled();
  });
  it('rejects native evaluation failures and nonfinite totals before writes', async () => {
    g.Roll.prototype.evaluate = async () => {
      throw new Error('bad');
    };
    expect(await rollFormulaHandler(ctx('roll_formula', { formula: '1d6' }))).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    g.Roll.prototype.evaluate = async () => ({ total: Infinity, terms: [] });
    expect(await rollFormulaHandler(ctx('roll_formula', { formula: '1 / 0' }))).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(created).toHaveLength(0);
  });
});

describe('canonical journal writes', () => {
  it.each([user, gm])(
    'creates a page as $id using create intent and actual new UUID audit target',
    async (who) => {
      g.game.user = who;
      const c = ctx('journal_write', { ...argsPage, pageUuid: undefined }, who);
      const result = await journalWriteHandler(c);
      expect(result).toMatchObject({
        structured: { pageUuid: 'JournalEntry.j.JournalEntryPage.new1', created: true },
      });
      expect(c.intendCreate).toHaveBeenCalledWith(journal);
      expect(c.created).toHaveBeenCalledWith('JournalEntry.j.JournalEntryPage.new1', journal);
      expect(c.snapshot).not.toHaveBeenCalled();
      expect(created[0].options).toBe(c.callOptions);
    },
  );
  it('appends only after actual-page snapshot and fresh permission check', async () => {
    const c = ctx('journal_write', argsPage);
    await journalWriteHandler(c);
    expect(c.snapshot).toHaveBeenCalledWith(page.uuid);
    expect(page.text.content).toContain('<strong>new</strong>');
    expect(page.update.mock.calls[0][1]).toBe(c.callOptions);
  });
  it.each([
    'parent',
    'type',
    'format',
    'page-owner',
    'journal-owner',
    'audit-page',
    'audit-journal',
    'compendium',
  ])('rejects %s before mutation', async (reason) => {
    if (reason === 'parent') page.parent = doc('JournalEntry.other', 'JournalEntry');
    if (reason === 'type') page.type = 'image';
    if (reason === 'format') page.text.format = 2;
    if (reason === 'page-owner') page.owners.clear();
    if (reason === 'journal-owner') journal.owners.clear();
    if (reason === 'audit-page') page.flags = { 'agent-gateway': { auditJournal: true } };
    if (reason === 'audit-journal') journal.flags = { 'agent-gateway': { auditJournal: true } };
    if (reason === 'compendium') journal.pack = 'world.journals';
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(page.update).not.toHaveBeenCalled();
  });
  it.each(['permissions', 'format', 'parent', 'identity'])(
    'rechecks %s after asynchronous snapshot',
    async (what) => {
      const c = ctx('journal_write', argsPage);
      c.snapshot.mockImplementation(async () => {
        if (what === 'permissions') page.owners.clear();
        if (what === 'format') page.text.format = 2;
        if (what === 'parent') page.parent = doc('JournalEntry.other', 'JournalEntry');
        if (what === 'identity') page.uuid = 'JournalEntry.j.JournalEntryPage.other';
      });
      expect(await journalWriteHandler(c)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(page.update).not.toHaveBeenCalled();
    },
  );
  it('rechecks create permissions after asynchronous intent', async () => {
    const c = ctx('journal_write', { ...argsPage, pageUuid: undefined });
    c.intendCreate.mockImplementation(async () => {
      journal.owners.clear();
    });
    expect(await journalWriteHandler(c)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(created).toHaveLength(0);
  });
  it('serializes alias appends with snapshot/read/update in the same turn', async () => {
    docs.set('alias', page);
    const hold = deferred();
    const entered = deferred();
    let count = 0;
    page.update.mockImplementation(async (data: any) => {
      if (++count === 1) {
        entered.resolve();
        await hold.promise;
      }
      page.text.content = data['text.content'];
    });
    const one = ctx('journal_write', { ...argsPage, markdown: 'first' });
    const two = ctx('journal_write', { ...argsPage, pageUuid: 'alias', markdown: 'second' });
    const a = journalWriteHandler(one);
    await entered.promise;
    const b = journalWriteHandler(two);
    await settle();
    expect(two.snapshot).not.toHaveBeenCalled();
    hold.resolve();
    await Promise.all([a, b]);
    expect(page.text.content).toContain('first');
    expect(page.text.content).toContain('second');
  });
  it('bounds pending resolution, releases failures and permits unrelated pages', async () => {
    const hold = deferred();
    const original = g.fromUuid;
    g.fromUuid = async (uuid: string) => {
      if (uuid === 'blocked') {
        await hold.promise;
        return undefined;
      }
      return original(uuid);
    };
    const jobs = Array.from({ length: 64 }, () =>
      journalWriteHandler(ctx('journal_write', { ...argsPage, pageUuid: 'blocked' })),
    );
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      error: { code: 'FORBIDDEN', message: expect.stringContaining('Too many') },
    });
    hold.resolve();
    await Promise.all(jobs);
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      structured: { created: false },
    });
  });
  it('allows another page while first update awaits and releases failed turns', async () => {
    const hold = deferred();
    const entered = deferred();
    page.update.mockImplementationOnce(async () => {
      entered.resolve();
      await hold.promise;
      throw new Error('update failed');
    });
    const first = journalWriteHandler(ctx('journal_write', argsPage));
    const rejection = expect(first).rejects.toThrow('update failed');
    await entered.promise;
    const other = doc('JournalEntry.j.JournalEntryPage.other', 'JournalEntryPage', {
      parent: journal,
      type: 'text',
      text: { format: 1, content: '' },
    });
    expect(
      await journalWriteHandler(ctx('journal_write', { ...argsPage, pageUuid: other.uuid })),
    ).toMatchObject({ structured: { created: false } });
    hold.resolve();
    await rejection;
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      structured: { created: false },
    });
  });
  it('checks ownership synchronously at the actual write call after final preparation', async () => {
    let checks = 0;
    page.testUserPermission.mockImplementation(() => {
      if (++checks === 2) queueMicrotask(() => page.owners.clear());
      return page.owners.has('p1');
    });
    page.update.mockImplementation(async () => {
      expect(page.owners.has('p1')).toBe(true);
      return page;
    });
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      structured: { created: false },
    });
  });
  it('caps accumulated page size before replacement', async () => {
    page.text.content = 'x'.repeat(100000);
    expect(await journalWriteHandler(ctx('journal_write', argsPage))).toMatchObject({
      error: { code: 'FORBIDDEN' },
    });
    expect(page.update).not.toHaveBeenCalled();
  });
});

function integrated(who = user) {
  g.game.user = who;
  const records: AuditRecord[] = [];
  const hub = new Hub();
  hub.tools = defs;
  hub.addUser('p1', false);
  hub.addUser('gm', true);
  const client = hub.client(who.id);
  let id = 0;
  const requestIntent = vi.fn(async () => true);
  const dispatch = createDispatcher({
    tools: defs,
    handlers,
    stages: [
      createPolicyStage({ tools: defs }),
      createApprovalStage(() => client.manager, defs),
      createAuditStage({
        isGM: () => who.isGM,
        requestIntent,
        categoryOf: () => 'write',
        fromUuid: async (uuid) => docs.get(uuid),
        submit: async (r) => {
          records.push(r);
        },
        newId: () => `entry-${++id}`,
        watchChanges: () => () => {},
      }),
    ],
  });
  const call = (tool: string, args: any) =>
    dispatch(
      {
        tool,
        args,
        agent: { id: 'agent', ownerUserId: who.id, headless: false },
        sessionId: 'session',
      },
      who,
    );
  return { call, records, client, requestIntent };
}

describe('default policy and real approval/audit dispatcher integration', () => {
  it.each([user, gm])(
    'owner $id must approve each create/append and duplicate approval resolves once',
    async (who) => {
      const r = integrated(who);
      for (const [tool, args] of [
        ['chat_post', { content: '**hello**' }],
        ['roll_formula', { formula: '1d6' }],
        ['journal_write', { ...argsPage, pageUuid: undefined }],
        ['journal_write', argsPage],
        ['roll_formula', { formula: '1d6', toChat: false }],
      ] as const) {
        const before = created.length + page.update.mock.calls.length;
        const result = r.call(tool, args);
        await settle();
        const [request] = r.client.manager.listPending();
        expect(request).toMatchObject({ tool, approver: 'owner' });
        expect(created.length + page.update.mock.calls.length).toBe(before);
        expect(r.client.manager.resolveApproval(request!.id, { decision: 'approve' })).toBe(true);
        expect(r.client.manager.resolveApproval(request!.id, { decision: 'approve' })).toBe(false);
        expect(await result).not.toHaveProperty('error');
        expect(created.length + page.update.mock.calls.length).toBe(
          before + (tool === 'roll_formula' && 'toChat' in args ? 0 : 1),
        );
      }
      expect(r.records).toHaveLength(5);
      if (who.isGM) {
        for (const record of r.records.slice(0, 3))
          expect(record.targets).toEqual([
            expect.objectContaining({ existed: false, undoable: true }),
          ]);
        expect(r.records[3]!.targets).toEqual([
          expect.objectContaining({
            uuid: page.uuid,
            existed: true,
            before: expect.objectContaining({ text: { format: 1, content: '<p>old</p>' } }),
            undoable: true,
          }),
        ]);
        expect(r.requestIntent).not.toHaveBeenCalled();
      } else {
        for (const record of r.records.slice(0, 4))
          expect(record.targets).toEqual([
            expect.objectContaining({ before: null, undoable: false }),
          ]);
        expect(r.requestIntent).toHaveBeenCalledWith(expect.any(String), { creates: true });
        expect(r.requestIntent).toHaveBeenCalledWith(expect.any(String), { uuid: page.uuid });
      }
      expect(r.records[4]!.targets).toEqual([]);
    },
  );
  it('permission loss while awaiting approval fails closed and records no mutation target', async () => {
    const r = integrated();
    const result = r.call('journal_write', argsPage);
    await settle();
    page.owners.clear();
    expect(
      r.client.manager.resolveApproval(r.client.manager.listPending()[0]!.id, {
        decision: 'approve',
      }),
    ).toBe(true);
    expect(await result).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(page.update).not.toHaveBeenCalled();
    expect(r.records[0]!.targets).toEqual([]);
  });
});
