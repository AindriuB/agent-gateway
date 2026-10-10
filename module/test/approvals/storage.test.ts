/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_CONFIG } from '../../src/approvals/config.js';
import { pipeline, settle, world } from './rig.js';

afterEach(() => vi.restoreAllMocks());

describe('a storage that throws never breaks the approval flow', () => {
  it('create, resolve and execute all complete, the caller gets its result, and it logs once', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hub = world();
    const p1 = hub.client('p1', { saveThrows: true });
    const gm = hub.client('gm');
    const { call, handler } = pipeline(p1, 'gm');

    // create: the relay and the waiter are still set up
    const done = call('write_thing', { id: 'a' });
    await settle();
    expect(gm.manager.listPending()).toHaveLength(1);
    // resolve and execute: the GM's approval runs the handler and the result comes back
    gm.manager.resolveApproval(gm.manager.listPending()[0]!.id, { decision: 'approve' });
    expect(await done).toEqual({ text: 'ran write_thing {"id":"a"}', structured: {} });
    expect(handler).toHaveBeenCalledTimes(1);
    // the result is readable in memory although nothing was saved
    const id = p1.manager.ownRecords()[0]!.id;
    expect(((await call('approval_status', { id })) as any).structured).toMatchObject({
      status: 'approved',
      result: 'ran write_thing {"id":"a"}',
    });
    expect(p1.storage.text).toBe('');
    expect(err.mock.calls.filter((c) => String(c[0]).includes('approval queue'))).toHaveLength(1);
  });

  it('a timeout to pending and a denial also complete', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const hub = world();
    const p1 = hub.client('p1', { saveThrows: true });
    const gm = hub.client('gm');
    const { call } = pipeline(p1, 'gm');
    const pending = call('write_thing');
    await hub.advance(APPROVAL_CONFIG.APPROVAL_WAIT_MS);
    expect((await pending) as any).toMatchObject({ structured: { status: 'pending_approval' } });
    const id = gm.manager.listPending()[0]!.id;
    gm.manager.resolveApproval(id, { decision: 'deny', reason: 'no' });
    expect(((await call('approval_status', { id })) as any).structured.status).toBe('denied');
  });
});

describe('what is kept is bounded', () => {
  const approveAll = async (n: number, big = 0) => {
    const hub = world();
    const p1 = hub.client('p1');
    const rig = pipeline(p1);
    if (big)
      rig.handler.mockImplementation(async () => ({ text: 'x'.repeat(big), structured: {} }));
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const done = rig.call('write_thing', { id: String(i) });
      await settle();
      const id = p1.manager.listPending()[0]!.id;
      ids.push(id);
      p1.manager.resolveApproval(id, { decision: 'approve' });
      await done;
    }
    return { p1, ids, rig };
  };

  it('a stored result is cut to the result cap', async () => {
    const { p1, ids } = await approveAll(1, 3 * APPROVAL_CONFIG.MAX_RESULT_CHARS);
    const rec = p1.manager.ownRecords().find((r) => r.id === ids[0])!;
    expect(rec.result!.text.length).toBe(APPROVAL_CONFIG.MAX_RESULT_CHARS);
  });

  it('total storage stays under the cap, evicting the oldest resolved records first', async () => {
    const n = Math.ceil((2 * APPROVAL_CONFIG.MAX_STORE_CHARS) / APPROVAL_CONFIG.MAX_RESULT_CHARS);
    const { p1, ids } = await approveAll(n, APPROVAL_CONFIG.MAX_RESULT_CHARS);
    expect(p1.storage.text.length).toBeLessThanOrEqual(APPROVAL_CONFIG.MAX_STORE_CHARS);
    const kept = new Set(p1.manager.ownRecords().map((r) => r.id));
    expect(kept.has(ids[0]!)).toBe(false);
    expect(kept.has(ids.at(-1)!)).toBe(true);
    expect(kept.size).toBeLessThan(n);
  });

  it('the record count is capped and the oldest go first', async () => {
    const { p1, ids } = await approveAll(APPROVAL_CONFIG.MAX_RECORDS + 10);
    const kept = new Set(p1.manager.ownRecords().map((r) => r.id));
    expect(kept.size).toBe(APPROVAL_CONFIG.MAX_RECORDS);
    expect(kept.has(ids[0]!)).toBe(false);
    expect(kept.has(ids.at(-1)!)).toBe(true);
  });

  it('pending requests are never evicted by the size cap', async () => {
    const hub = world();
    const p1 = hub.client('p1');
    const { call } = pipeline(p1);
    void call('write_thing', { id: 'keep' });
    await settle();
    const id = p1.manager.listPending()[0]!.id;
    for (let i = 0; i < 3; i++) {
      const d = call('other_write', { id: String(i) });
      await settle();
      p1.manager.resolveApproval(
        p1.manager.listPending().find((r) => r.tool === 'other_write')!.id,
        {
          decision: 'approve',
        },
      );
      await d;
    }
    expect(p1.manager.ownRecords().some((r) => r.id === id && r.status === 'pending')).toBe(true);
  });
});
