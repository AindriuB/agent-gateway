import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditRelay, type RelayDeps } from '../../src/audit/relay.js';
import { record } from './fake.js';

afterEach(() => vi.restoreAllMocks());

function rig() {
  const emit = vi.fn();
  const write = vi.fn<RelayDeps['write']>();
  const relay = new AuditRelay({
    selfId: () => 'gm1',
    isGM: () => true,
    activeGMId: () => 'gm1',
    isUserGM: (id) => id.startsWith('gm'),
    emit,
    write,
    onIntent: async () => true,
    setTimer: () => 0,
    clearTimer: () => {},
    now: () => 1000,
  });
  return { relay, emit, write };
}

describe.each(['p1', 'gm2'])('relay writes from %s', (sender) => {
  it.each([false, true])(
    'reserves an ID until its write completes (normalised resend: %s)',
    async (normalise) => {
      const { relay, emit, write } = rig();
      let finish!: () => void;
      write.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const msg = { kind: 'audit.entry', record: record() };
      const first = relay.onMessage(msg, sender);
      const duplicateMsg = normalise
        ? { ...msg, record: { ...msg.record, entryId: ` ${msg.record.entryId} ` } }
        : msg;
      const duplicate = relay.onMessage(duplicateMsg, sender);
      expect(write).toHaveBeenCalledTimes(1);
      expect(emit).not.toHaveBeenCalled();
      finish();
      await Promise.all([first, duplicate]);
      expect(emit).toHaveBeenCalledWith({ kind: 'audit.ack', id: msg.record.entryId }, [sender]);
      await relay.onMessage(duplicateMsg, sender);
      expect(write).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledTimes(2);
    },
  );

  it('releases a failed reservation so the unacknowledged entry can be retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { relay, emit, write } = rig();
    let fail!: (err: Error) => void;
    write.mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = reject;
        }),
    );
    const msg = { kind: 'audit.entry', record: record() };
    const first = relay.onMessage(msg, sender);
    await relay.onMessage(msg, sender);
    expect(write).toHaveBeenCalledTimes(1);
    fail(new Error('temporary journal failure'));
    await first;
    expect(emit).not.toHaveBeenCalled();
    write.mockResolvedValueOnce();
    await relay.onMessage(msg, sender);
    expect(write).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

it('different entry IDs can persist independently', async () => {
  const { relay, write } = rig();
  let finish!: () => void;
  write.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  write.mockResolvedValueOnce();
  const first = relay.onMessage({ kind: 'audit.entry', record: record() }, 'p1');
  await relay.onMessage(
    { kind: 'audit.entry', record: record({ entryId: 'entry-other001' }) },
    'p1',
  );
  expect(write).toHaveBeenCalledTimes(2);
  finish();
  await first;
});

describe.each([false, true])('sender-scoped entry IDs (normalised ID: %s)', (normalise) => {
  const messages = () => {
    const attacker = { kind: 'audit.entry', record: record({ userId: 'p1' }) };
    const legitimate = {
      ...attacker,
      record: {
        ...attacker.record,
        entryId: normalise ? ` ${attacker.record.entryId} ` : attacker.record.entryId,
      },
    };
    return { attacker, legitimate };
  };

  it('does not let a completed record suppress the same ID from another authenticated sender', async () => {
    const { relay, emit, write } = rig();
    const { attacker, legitimate } = messages();
    await relay.onMessage(attacker, 'p2');
    await relay.onMessage(legitimate, 'p1');
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: 'p2' }), 'p2');
    expect(write).toHaveBeenNthCalledWith(2, expect.objectContaining({ userId: 'p1' }), 'p1');
    await relay.onMessage(attacker, 'p2');
    await relay.onMessage(legitimate, 'p1');
    expect(write).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledTimes(4);
  });

  it('reserves writes independently for two senders with the same ID', async () => {
    const { relay, emit, write } = rig();
    const finishes = new Map<string, () => void>();
    write.mockImplementation(
      (_record, sender) => new Promise<void>((resolve) => finishes.set(sender, resolve)),
    );
    const { attacker, legitimate } = messages();
    const first = relay.onMessage(attacker, 'p2');
    const second = relay.onMessage(legitimate, 'p1');
    await relay.onMessage(attacker, 'p2');
    await relay.onMessage(legitimate, 'p1');
    const writes = write.mock.calls.length;
    const earlyAcks = emit.mock.calls.length;
    for (const finish of finishes.values()) finish();
    await Promise.all([first, second]);
    expect(writes).toBe(2);
    expect(earlyAcks).toBe(0);
    expect(emit).toHaveBeenCalledWith({ kind: 'audit.ack', id: attacker.record.entryId }, ['p1']);
    expect(emit).toHaveBeenCalledWith({ kind: 'audit.ack', id: attacker.record.entryId }, ['p2']);
  });
});
