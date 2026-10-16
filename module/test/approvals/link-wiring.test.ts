/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import { OWNERSHIP_WAIT_MS, startApprovals, wireApprovalLink } from '../../src/approvals/live.js';
import { pipeline, settle, world } from './rig.js';

vi.mock('../../src/link/runtime.js', async (orig) => ({
  ...(await orig<object>()),
  getLinkClient: () => runtimeLink,
}));
let runtimeLink: any = {};

/** A fake link client: records what the approval wiring sends, in order, and lets a test drive it. */
function fakeLink(log: string[]) {
  let onState: (s: { kind: string; reason?: string }) => void = () => {};
  let onOwnership: (ids: string[], unknown: string[]) => void = () => {};
  return {
    sent: [] as any[],
    onState(fn: typeof onState) {
      onState = fn;
    },
    onApprovalOwnership(fn: typeof onOwnership) {
      onOwnership = fn;
    },
    sendApprovalState(this: { sent: any[] }, msg: any) {
      this.sent.push(msg);
      log.push('ids' in msg ? 'list' : msg.state);
      return true;
    },
    state: (kind: string, reason?: string) => onState({ kind, reason }),
    ownership: (ids: string[], unknown: string[] = []) => onOwnership(ids, unknown),
  };
}

const setup = async () => {
  const log: string[] = [];
  const hub = world();
  const p1 = hub.client('p1');
  hub.client('gm');
  const rig = pipeline(p1, 'owner');
  rig.handler.mockImplementation(async () => {
    log.push('run');
    return { text: 'ran', structured: {} };
  });
  const link = fakeLink(log);
  const notes: string[] = [];
  wireApprovalLink(p1.manager, link, (t) => notes.push(t));
  link.state('connected');
  const done = rig.call('write_thing', { id: 'x' });
  await settle();
  const id = p1.manager.ownRecords()[0]!.id;
  const gmRequests = () =>
    hub.sent.filter((m: any) => m.data.t === 'approval.request' && (m.to ?? []).includes('gm'));
  return { hub, p1, link, log, notes, id, done, gmRequests, ...rig };
};

describe('approval wiring through the link state', () => {
  it('holds an approval across a drop; on reconnect: list, then ownership, then approved, then the run', async () => {
    const { p1, link, log, id, done, handler } = await setup();
    link.sent.length = 0;
    log.length = 0;
    link.state('disconnected', 'ERROR');
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(true);
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(link.sent).toEqual([]);
    link.state('connected');
    await settle();
    expect(log).toEqual(['list']); // nothing released before the gateway confirms
    expect(handler).not.toHaveBeenCalled();
    link.ownership([id]);
    expect(await done).toMatchObject({ text: 'ran' });
    expect(log).toEqual(['list', 'approved', 'run']);
    expect(link.sent[0]).toEqual({ ids: [id] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('a plain blip keeps the record and presents it again once ownership is confirmed', async () => {
    const { p1, link, id, gmRequests } = await setup();
    const before = gmRequests().length;
    link.state('disconnected', 'ERROR');
    link.state('connected');
    await settle();
    expect(gmRequests().length).toBe(before); // not re-presented until confirmed
    link.ownership([id]);
    expect(gmRequests().length).toBe(before + 1);
    expect(p1.manager.pendingApprovalIds()).toEqual([id]);
  });

  it('a stale tab: ownership that omits the record withdraws it, drops the held answer, runs nothing', async () => {
    const { p1, link, log, notes, id, handler, gmRequests } = await setup();
    link.state('disconnected', 'ERROR');
    p1.manager.resolveApproval(id, { decision: 'approve' });
    link.state('connected');
    link.sent.length = 0;
    log.length = 0;
    const before = gmRequests().length;
    link.ownership([]); // another tab has it now
    await settle();
    expect(handler).not.toHaveBeenCalled();
    expect(link.sent).toEqual([]);
    expect(log).toEqual([]);
    expect(gmRequests().length).toBe(before);
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
    expect(notes).toHaveLength(1);
    // Nothing waiting is left to be released by a later reconnect.
    link.state('disconnected', 'ERROR');
    link.state('connected');
    link.ownership([]);
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps only the records the gateway lists and withdraws the rest, reporting nothing', async () => {
    const { p1, link, call, id } = (await setup()) as any;
    void call('write_thing', { id: 'second' });
    await settle();
    const ids = p1.manager.ownRecords().map((r: any) => r.id);
    const other = ids.find((x: string) => x !== id);
    link.state('disconnected', 'ERROR');
    link.state('connected');
    link.sent.length = 0;
    link.ownership([other]);
    expect(p1.manager.pendingApprovalIds()).toEqual([other]);
    expect(link.sent).toEqual([]);
  });

  it('a record the gateway never mirrored (unknown list) is kept through a blip and runs once', async () => {
    const { p1, link, log, id, done, handler } = await setup();
    link.state('disconnected', 'ERROR');
    p1.manager.resolveApproval(id, { decision: 'approve' });
    link.state('connected');
    log.length = 0;
    link.ownership([], [id]); // no gateway row at all, e.g. an image_upload approval
    expect(await done).toMatchObject({ text: 'ran' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(log).toEqual(['approved', 'run']);
  });

  it('an alias the gateway knows but does not own (requeued elsewhere) is still withdrawn', async () => {
    const { p1, link, id, handler } = await setup();
    link.state('disconnected', 'ERROR');
    p1.manager.resolveApproval(id, { decision: 'approve' });
    link.state('connected');
    link.ownership([], ['some-other-id']);
    await settle();
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('no ownership reply within the wait withdraws everything', async () => {
    const { hub, p1, link, notes, handler, id } = await setup();
    link.state('disconnected', 'ERROR');
    p1.manager.resolveApproval(id, { decision: 'approve' });
    link.state('connected');
    link.sent.length = 0;
    await hub.advance(OWNERSHIP_WAIT_MS - 1);
    expect(p1.manager.pendingApprovalIds()).toEqual([id]);
    await hub.advance(2);
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
    expect(link.sent).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
    expect(notes).toHaveLength(1);
    link.ownership([id]); // a late reply changes nothing
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a REPLACED close withdraws the records and sends nothing', async () => {
    const { p1, link, notes, handler, id } = await setup();
    link.sent.length = 0;
    link.state('disconnected', 'REPLACED');
    expect(p1.manager.pendingApprovalIds()).toEqual([]);
    expect(link.sent).toEqual([]);
    expect(notes).toEqual([expect.stringContaining('will be asked again')]);
    expect(p1.manager.resolveApproval(id, { decision: 'approve' })).toBe(false);
    await settle();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a gateway that cannot mirror gets no wait: held answers run on reconnect as before', async () => {
    const log: string[] = [];
    const hub = world();
    const p1 = hub.client('p1');
    hub.client('gm');
    const rig = pipeline(p1, 'owner');
    const link: any = fakeLink(log);
    link.sendApprovalState = () => false; // a 7.1.0 gateway
    wireApprovalLink(p1.manager, link, () => {});
    link.state('connected');
    const done = rig.call('write_thing', { id: 'old' });
    await settle();
    const id = p1.manager.ownRecords()[0]!.id;
    link.state('disconnected', 'ERROR');
    p1.manager.resolveApproval(id, { decision: 'approve' });
    link.state('connected');
    expect(await done).toMatchObject({ text: expect.stringContaining('ran') });
    expect(rig.handler).toHaveBeenCalledTimes(1);
  });
});

describe('startApprovals', () => {
  it('wires the link: the pending list goes out on connect and ownership replies are listened for', () => {
    let state: (s: { kind: string }) => void = () => {};
    let ownership: (ids: string[], unknown: string[]) => void = () => {};
    const sent: any[] = [];
    runtimeLink = {
      onState: (fn: typeof state) => (state = fn),
      onApprovalOwnership: (fn: typeof ownership) => (ownership = fn),
      sendApprovalState: (m: any) => (sent.push(m), true),
    };
    (globalThis as any).game = {
      user: { id: 'p1', isGM: false },
      users: { get: () => undefined, contents: [] },
      socket: { on: vi.fn(), emit: vi.fn() },
    };
    (globalThis as any).Hooks = { on: vi.fn(), callAll: vi.fn() };
    try {
      startApprovals();
      state({ kind: 'connected' });
      expect(sent).toEqual([{ ids: [] }]);
      expect(() => ownership([], [])).not.toThrow();
    } finally {
      delete (globalThis as any).game;
      delete (globalThis as any).Hooks;
    }
  });
});
