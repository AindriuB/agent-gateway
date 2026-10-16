import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnnouncedTool } from '@agent-gateway/protocol';
import { carriesImage } from '../../src/offline-queue/service.js';
import { QUEUE_CONFIG } from '../../src/offline-queue/repository.js';
import { openStore, type Store } from '../../src/store/store.js';

const owner = { worldId: 'w', userId: 'u', agentId: 'a' };
const other = { worldId: 'w', userId: 'v', agentId: 'b' };
const def: AnnouncedTool = {
  name: 'chat_post',
  category: 'write',
  minRole: 'player',
  description: 'x',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: { type: 'object', properties: {}, additionalProperties: false },
};
const stores: Store[] = [];
const dirs: string[] = [];
const open = (path = ':memory:') => {
  const s = openStore(path);
  stores.push(s);
  return s;
};
afterEach(() => {
  for (const s of stores.splice(0))
    try {
      s.close();
    } catch {
      /* closed by the test */
    }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mirror = (s: Store, alias = 'alias-1', conn: string | null = 'c1', now = 10, o = owner) =>
  s.queue.insertAlias(o, 'sess', def, { content: 'hi' }, alias, conn, now);

describe('mirrored approval rows (migration 014)', () => {
  it('adds the alias columns and keeps old rows unaffected', () => {
    const s = open();
    const plain = s.queue.enqueue(owner, 's', def, {}, 1);
    expect(plain).toMatchObject({ approval_alias: null, alias_report: null, orphaned_at: null });
    const r = mirror(s);
    expect(r).toMatchObject({
      state: 'pending',
      approval_alias: 'alias-1',
      alias_report: 'pending',
      connection_id: 'c1',
      orphaned_at: null,
      expires_at: 10 + QUEUE_CONFIG.ttlMs,
    });
  });

  it('creates one row per alias and per owner', () => {
    const s = open();
    const a = mirror(s);
    expect(mirror(s).id).toBe(a.id);
    expect(mirror(s, 'alias-1', 'c9', 11, other).id).not.toBe(a.id);
  });

  it('records the module report only from the holding connection and owner', () => {
    const s = open();
    mirror(s);
    expect(s.queue.report(owner, 'c-other', 'alias-1', 'approved', 11)).toBe(false);
    expect(s.queue.report(other, 'c1', 'alias-1', 'approved', 11)).toBe(false);
    expect(s.queue.report(owner, 'c1', 'unknown-alias', 'approved', 11)).toBe(false);
    expect(s.queue.getByAlias(owner, 'alias-1')?.alias_report).toBe('pending');
    expect(s.queue.report(owner, 'c1', 'alias-1', 'approved', 12)).toBe(true);
    expect(s.queue.getByAlias(owner, 'alias-1')).toMatchObject({
      alias_report: 'approved',
      state: 'unknown',
      resolved_at: 12,
    });
    mirror(s, 'alias-2');
    s.queue.report(owner, 'c1', 'alias-2', 'denied', 13);
    expect(s.queue.getByAlias(owner, 'alias-2')).toMatchObject({
      alias_report: 'denied',
      state: 'denied',
    });
  });

  it('is invisible to another owner', () => {
    const s = open();
    mirror(s);
    expect(s.queue.getByAlias(other, 'alias-1')).toBeUndefined();
    expect(s.queue.findOpenAlias(other, 'chat_post', 'x')).toBeUndefined();
  });

  it('orphans a row last reported pending and sends an approved one to unknown', () => {
    const s = open();
    mirror(s, 'p');
    mirror(s, 'a');
    s.queue.report(owner, 'c1', 'a', 'approved', 11);
    s.queue.disconnected('c1', 20);
    expect(s.queue.getByAlias(owner, 'p')).toMatchObject({
      state: 'pending',
      orphaned_at: 20,
      connection_id: null,
    });
    expect(s.queue.getByAlias(owner, 'a')).toMatchObject({ state: 'unknown', orphaned_at: 20 });
  });

  it("keeps today's behaviour for plain claimed rows", () => {
    const s = open();
    const r = s.queue.enqueue(owner, 's', def, {}, 1);
    s.queue.claim(owner, r.id, 'c1');
    s.queue.disconnected('c1', 5);
    expect(s.queue.get(owner, r.id)?.state).toBe('unknown');
  });

  it('reconcile: listed orphans go live again, unlisted are requeued, approved never', () => {
    const s = open();
    mirror(s, 'keep');
    mirror(s, 'gone');
    s.queue.disconnected('c1', 20);
    s.queue.reconcile(owner, 'c2', new Set(['keep']), 30);
    expect(s.queue.getByAlias(owner, 'keep')).toMatchObject({
      state: 'pending',
      connection_id: 'c2',
      orphaned_at: null,
    });
    const gone = s.queue.getByAlias(owner, 'gone')!;
    expect(gone).toMatchObject({ state: 'queued', connection_id: null });
    expect(s.queue.queued(owner).map((r) => r.id)).toEqual([gone.id]);
  });

  it('reconcile leaves a row being replayed alone', () => {
    const s = open();
    mirror(s, 'x');
    s.queue.disconnected('c1', 20);
    s.queue.reconcile(owner, 'c2', new Set(), 30);
    const row = s.queue.getByAlias(owner, 'x')!;
    s.queue.claim(owner, row.id, 'c2');
    s.queue.reconcile(owner, 'c3', new Set(['x']), 40);
    expect(s.queue.get(owner, row.id)).toMatchObject({ state: 'claimed', connection_id: 'c2' });
  });

  it('reconcile does not touch another owner', () => {
    const s = open();
    mirror(s, 'x');
    s.queue.disconnected('c1', 20);
    s.queue.reconcile(other, 'c2', new Set(), 30);
    expect(s.queue.getByAlias(owner, 'x')?.state).toBe('pending');
  });

  it('expires an orphan past its deadline and never offers it again', () => {
    const s = open();
    mirror(s, 'x', 'c1', 10);
    s.queue.disconnected('c1', 20);
    const late = 10 + QUEUE_CONFIG.ttlMs;
    s.queue.expireOrphans(late);
    s.queue.cleanup(late);
    expect(s.queue.getByAlias(owner, 'x')?.state).toBe('expired');
    s.queue.reconcile(owner, 'c2', new Set(), late + 1);
    expect(s.queue.queued(owner)).toEqual([]);
  });

  it('survives a gateway restart as an orphan, but an approved row does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-'));
    dirs.push(dir);
    const path = join(dir, 'q.sqlite');
    const s = open(path);
    mirror(s, 'p');
    mirror(s, 'a');
    s.queue.report(owner, 'c1', 'a', 'approved', 11);
    mirror(s, 'live-no-disconnect');
    s.queue.disconnected('c1', 20); // all three orphaned or unknown here
    mirror(s, 'dead-live', 'c7', 21); // still attached when the process dies
    s.close();
    const again = open(path);
    // What the service does at start, in order.
    again.queue.orphanLive(30);
    again.queue.recover(30);
    expect(again.queue.getByAlias(owner, 'p')).toMatchObject({ state: 'pending' });
    expect(again.queue.getByAlias(owner, 'live-no-disconnect')?.state).toBe('pending');
    expect(again.queue.getByAlias(owner, 'dead-live')).toMatchObject({
      state: 'pending',
      connection_id: null,
    });
    expect(again.queue.getByAlias(owner, 'a')?.state).toBe('unknown');
    again.queue.reconcile(owner, 'c2', new Set(), 40);
    expect(again.queue.queued(owner)).toHaveLength(3);
  });

  it('finds an open orphan by tool and args hash for the offline retry', () => {
    const s = open();
    const r = mirror(s);
    expect(s.queue.findOpenAlias(owner, 'chat_post', r.args_hash)).toBeUndefined();
    s.queue.disconnected('c1', 20);
    expect(s.queue.findOpenAlias(owner, 'chat_post', r.args_hash)?.approval_alias).toBe('alias-1');
    expect(s.queue.findOpenAlias(owner, 'other_tool', r.args_hash)).toBeUndefined();
  });

  it('an approved report frees queue capacity: 25 mirror+approve cycles never hit the cap', () => {
    const s = open();
    for (let i = 0; i < 25; i++) {
      mirror(s, `cycle-${i}`, 'c1', 10 + i);
      expect(s.queue.report(owner, 'c1', `cycle-${i}`, 'approved', 10 + i)).toBe(true);
    }
    expect(s.queue.getByAlias(owner, 'cycle-24')?.state).toBe('unknown');
    // And on disconnect the approved rows still end orphaned-unknown, never requeued.
    s.queue.disconnected('c1', 99);
    expect(s.queue.getByAlias(owner, 'cycle-3')).toMatchObject({
      state: 'unknown',
      orphaned_at: 99,
      connection_id: null,
    });
    s.queue.reconcile(owner, 'c2', new Set(), 100);
    expect(s.queue.queued(owner)).toEqual([]);
  });
});

describe('ownedAliases', () => {
  it('lists only live pending rows of this owner on this connection', () => {
    const s = open();
    mirror(s, 'mine', 'c1');
    mirror(s, 'other-conn', 'c9');
    mirror(s, 'theirs', 'c1', 10, other);
    mirror(s, 'done', 'c1');
    s.queue.report(owner, 'c1', 'done', 'approved', 11);
    const ask = ['mine', 'other-conn', 'theirs', 'done', 'missing'];
    expect(s.queue.ownedAliases(owner, 'c1', ask)).toEqual(['mine']);
    expect(s.queue.ownedAliases(other, 'c1', ask)).toEqual(['theirs']);
    expect(s.queue.ownedAliases(owner, 'c1', [])).toEqual([]);
  });
});

describe('carriesImage', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000000', 'hex').toString('base64');
  it.each([
    ['a data:image URL', `data:image/png;base64,${png}`],
    ['any data: prefix', `data:application/octet-stream;base64,${png}`],
    ['leading whitespace', `  \n\t${png}`],
    ['whitespace inside the head', `${png.slice(0, 8)}\n${png.slice(8)}`],
    ['a numeric byte array', { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0] }],
    ['a nested value', { a: [{ b: `data:text/plain;base64,${png}` }] }],
  ])('flags %s', (_name, value) => expect(carriesImage(value)).toBe(true));
  it.each([
    ['plain text', 'Hello there, this is a perfectly ordinary chat message.'],
    ['a short integer array', [0x89, 0x50, 0x4e, 0x47]],
    ['a non-image integer array', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ['a plain object', { content: 'hi', n: 3 }],
  ])('does not flag %s', (_name, value) => expect(carriesImage(value)).toBe(false));
});
