import { describe, expect, it, vi } from 'vitest';
import { AuditRelay, RESEND_MS, type RelayDeps } from '../../src/audit/relay.js';
import { AUDIT_LIMITS } from '../../src/audit/types.js';
import type { AuditRecord } from '../../src/audit/types.js';
import { record } from './fake.js';

function rig(self: { id: string; gm: boolean }, world: { activeGM: string | null; gms: string[] }) {
  const sent: unknown[] = [];
  const written: Array<{ record: AuditRecord; sender: string }> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  let now = 1_000_000;
  const deps: RelayDeps = {
    selfId: () => self.id,
    isGM: () => self.gm,
    activeGMId: () => world.activeGM,
    isUserGM: (id) => world.gms.includes(id),
    emit: (m) => void sent.push(m),
    write: async (r, sender) => void written.push({ record: r, sender }),
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => void ((h as { live: boolean }).live = false),
    now: () => now,
  };
  return {
    relay: new AuditRelay(deps),
    sent,
    written,
    timers,
    tick: (ms: number) => (now += ms),
    fire: () => timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn())),
  };
}

describe('audit relay: player side', () => {
  it('buffers while no GM is present and sends once one is', async () => {
    const world = { activeGM: null as string | null, gms: ['gm1'] };
    const p = rig({ id: 'p1', gm: false }, world);
    await p.relay.submit(record());
    expect(p.sent).toEqual([]);
    expect(p.relay.pending).toBe(1);
    world.activeGM = 'gm1';
    p.relay.onPresenceChange();
    expect(p.sent).toEqual([
      { kind: 'audit.entry', record: expect.objectContaining({ entryId: 'entry-0000001' }) },
    ]);
    expect(p.written).toEqual([]);
  });

  it('keeps resending until a GM acknowledges, and only a GM can acknowledge', async () => {
    const p = rig({ id: 'p1', gm: false }, { activeGM: 'gm1', gms: ['gm1'] });
    await p.relay.submit(record());
    p.fire();
    expect(p.sent).toHaveLength(2);
    expect(p.timers.at(-1)!.ms).toBe(RESEND_MS);
    await p.relay.onMessage({ kind: 'audit.ack', id: 'entry-0000001' }, 'p2');
    expect(p.relay.pending).toBe(1);
    await p.relay.onMessage({ kind: 'audit.ack', id: 'entry-0000001' }, 'gm1');
    expect(p.relay.pending).toBe(0);
    p.fire();
    expect(p.sent).toHaveLength(2);
  });

  it('caps the buffer and drops the oldest', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = rig({ id: 'p1', gm: false }, { activeGM: null, gms: [] });
    for (let i = 0; i < AUDIT_LIMITS.buffer + 5; i++) {
      await p.relay.submit(record({ entryId: `entry-${String(i).padStart(8, '0')}` }));
    }
    expect(p.relay.pending).toBe(AUDIT_LIMITS.buffer);
  });

  it('a GM client writes its own records directly and never relays them', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    await g.relay.submit(record({ userId: 'gm1' }));
    expect(g.sent).toEqual([]);
    expect(g.written).toHaveLength(1);
  });
});

describe('audit relay: GM side', () => {
  const entry = (over: object = {}) => ({ kind: 'audit.entry', record: { ...record(), ...over } });

  it('writes a relayed record as the attested sender, not the payload user', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    await g.relay.onMessage(entry({ userId: 'gm1', relayed: false, timestamp: 1 }), 'p1');
    expect(g.written).toHaveLength(1);
    expect(g.written[0]).toMatchObject({
      sender: 'p1',
      record: { userId: 'p1', relayed: true, timestamp: 1_000_000 },
    });
    expect(g.sent).toEqual([{ kind: 'audit.ack', id: 'entry-0000001' }]);
  });

  it('ignores a message with no attested sender', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    await g.relay.onMessage(entry(), undefined);
    await g.relay.onMessage(entry(), '');
    expect(g.written).toEqual([]);
  });

  it('only the designated active GM writes (two GMs online write once)', async () => {
    const g = rig({ id: 'gm2', gm: true }, { activeGM: 'gm1', gms: ['gm1', 'gm2'] });
    await g.relay.onMessage(entry(), 'p1');
    expect(g.written).toEqual([]);
  });

  it('a player client never writes a relayed record', async () => {
    const p = rig({ id: 'p2', gm: false }, { activeGM: 'gm1', gms: ['gm1'] });
    await p.relay.onMessage(entry(), 'p1');
    expect(p.written).toEqual([]);
  });

  it('writes a resent record once but acknowledges it again', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    await g.relay.onMessage(entry(), 'p1');
    await g.relay.onMessage(entry(), 'p1');
    expect(g.written).toHaveLength(1);
    expect(g.sent).toHaveLength(2);
  });

  it('does not acknowledge a record that failed to write, so the player resends it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    const original = g.written.push.bind(g.written);
    let fail = true;
    g.written.push = (...a) => {
      if (fail) throw new Error('disk');
      return original(...a);
    };
    await g.relay.onMessage(entry(), 'p1');
    expect(g.sent).toEqual([]);
    fail = false;
    await g.relay.onMessage(entry(), 'p1');
    expect(g.written).toHaveLength(1);
  });

  it('rejects malformed payloads and bounds oversized ones', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    for (const bad of [
      null,
      'x',
      5,
      { kind: 'audit.entry' },
      entry({ entryId: '../etc' }),
      entry({ tool: '' }),
    ]) {
      await g.relay.onMessage(bad, 'p1');
    }
    expect(g.written).toEqual([]);
    await g.relay.onMessage(
      entry({
        entryId: 'entry-bigbig01',
        args: 'a'.repeat(1_000_000),
        result: 'r'.repeat(100_000),
        tool: `${'t'.repeat(1000)}`,
        targets: Array.from({ length: 500 }, (_, i) => ({ uuid: `Actor.x${i}`, existed: false })),
      }),
      'p1',
    );
    const w = g.written[0]!.record;
    expect(w.args.length).toBeLessThanOrEqual(AUDIT_LIMITS.argsChars + 3);
    expect(w.result.length).toBeLessThanOrEqual(AUDIT_LIMITS.result + 3);
    expect(w.tool.length).toBeLessThanOrEqual(AUDIT_LIMITS.label + 3);
    expect(w.targets).toHaveLength(AUDIT_LIMITS.targets);
    expect(w.targetsDropped).toBe(450);
  });

  it('drops targets with hostile uuids and snapshots that are too large', async () => {
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    await g.relay.onMessage(
      entry({
        targets: [
          { uuid: 'Actor.<script>', existed: true, before: {} },
          {
            uuid: 'Actor.ok',
            existed: true,
            undoable: true,
            before: { b: 'x'.repeat(AUDIT_LIMITS.beforeChars) },
          },
        ],
      }),
      'p1',
    );
    const t = g.written[0]!.record.targets;
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ uuid: 'Actor.ok', before: null, undoable: false });
  });

  it('rate-limits a sender', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const g = rig({ id: 'gm1', gm: true }, { activeGM: 'gm1', gms: ['gm1'] });
    for (let i = 0; i < 70; i++) {
      await g.relay.onMessage(entry({ entryId: `entry-${String(i).padStart(8, '0')}` }), 'p1');
    }
    expect(g.written).toHaveLength(60);
    await g.relay.onMessage(entry({ entryId: 'entry-other-user' }), 'p2');
    expect(g.written).toHaveLength(61);
    g.tick(61_000);
    await g.relay.onMessage(entry({ entryId: 'entry-later-one' }), 'p1');
    expect(g.written).toHaveLength(62);
  });
});
