import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashToken } from '../../src/link/index.js';
import m001 from '../../src/store/migrations/001-pairings.js';
import { openStore } from '../../src/store/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  reconnectModule,
  tick,
  until,
  type FakeModule,
  type McpSession,
} from './harness.js';

let h: Harness | undefined;
const sessions: McpSession[] = [];
const modules: FakeModule[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  modules.splice(0).forEach((m) => m.tc.ws.terminate());
  await h?.server.close();
  h?.store.close();
  h = undefined;
});

const call = (s: McpSession) => s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
const silent = async (...ms: FakeModule[]) => {
  await tick();
  for (const m of ms) expect(m.tc.messages).toEqual([]);
};

describe('binding by user name', () => {
  it('ignores the name a reconnect claims in hello (Bob claiming to be alice)', async () => {
    h = await startServer();
    const alice = await pairModule(h, 'uA', { userName: 'alice' });
    const bob = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(alice, bob);
    alice.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uA') === undefined);
    const bob2 = await reconnectModule(h, bob, { claimName: 'alice' });
    modules.push(bob2);

    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    expectErrorCode(await call(s), 'WORLD_OFFLINE');
    await silent(bob2);
  });

  it('keeps the recorded name for display and binding after a reconnect with another name', async () => {
    h = await startServer();
    const bob = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(bob);
    const bob2 = await reconnectModule(h, bob, { claimName: 'mallory' });
    modules.push(bob2);
    expect(h.registry.get('w1', 'uB')?.info.userName).toBe('bob');
    const byRecorded = await openSession(h, { user: 'bob' });
    sessions.push(byRecorded);
    const p = call(byRecorded);
    const frame = (await bob2.tc.next('call')) as { id: string };
    bob2.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    expect((await p).isError).toBeFalsy();
    const byClaim = await openSession(h, { user: 'mallory' });
    sessions.push(byClaim);
    expectErrorCode(await call(byClaim), 'WORLD_OFFLINE');
    await silent(bob2);
  });

  it('treats a name shared by two paired users as ambiguous, even if one is offline', async () => {
    h = await startServer();
    const s1 = await pairModule(h, 'uA', { userName: 'sam' });
    const s2 = await pairModule(h, 'uB', { userName: 'sam' });
    modules.push(s1, s2);
    const both = await openSession(h, { user: 'sam' });
    sessions.push(both);
    expectErrorCode(await call(both), 'INVALID_ARGS');
    await silent(s1, s2);

    s2.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uB') === undefined);
    const oneOffline = await openSession(h, { user: 'sam' });
    sessions.push(oneOffline);
    expectErrorCode(await call(oneOffline), 'INVALID_ARGS');
    await silent(s1);
  });

  it('prefers an exact id match over another user whose name equals that id', async () => {
    h = await startServer();
    const named = await pairModule(h, 'uA', { userName: 'uB' }); // name equals the other's id
    const target = await pairModule(h, 'uB', { userName: 'carol' });
    modules.push(named, target);
    const s = await openSession(h, { user: 'uB' });
    sessions.push(s);
    const p = call(s);
    const frame = (await target.tc.next('call')) as { id: string };
    target.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    await p;
    await silent(named);
  });
});

describe('implicit binding', () => {
  it('stays ambiguous while two are connected, then binds to the survivor (follow mode)', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    const b = await pairModule(h, 'uB', { userName: 'bob' });
    modules.push(a, b);
    const s = await openSession(h);
    sessions.push(s);
    expectErrorCode(await call(s), 'INVALID_ARGS');
    a.tc.ws.close();
    await until(() => h!.registry.get('w1', 'uA') === undefined);
    const p = call(s);
    const frame = (await b.tc.next('call')) as { id: string };
    b.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'B' } });
    expect((await p).isError).toBeFalsy();
    await silent(a);
  });

  it('prints one line when it binds implicitly, and none when --user chose', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const lines: string[] = [];
    const implicit = await openSession(h, {}, undefined, 5000, { log: (l) => lines.push(l) });
    sessions.push(implicit);
    await implicit.client.listTools();
    const p = call(implicit);
    const frame = (await a.tc.next('call')) as { id: string };
    a.tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'A' } });
    await p;
    expect(lines).toEqual(['Bound MCP session to alice in w1; start with --user to choose.']);

    const explicit = await openSession(h, { user: 'alice' }, undefined, 5000, {
      log: (l) => lines.push(l),
    });
    sessions.push(explicit);
    await explicit.client.listTools();
    expect(lines).toHaveLength(1);
  });
});

describe('list_changed coalescing', () => {
  it('sends nothing for 20 token reconnects that leave the tool list unchanged', async () => {
    h = await startServer();
    let m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    await s.client.listTools();
    const base = s.listChanged.count;
    for (let i = 0; i < 20; i++) {
      m = await reconnectModule(h, m, { isGM: true });
      modules.push(m);
    }
    await tick(400);
    expect(s.listChanged.count - base).toBeLessThanOrEqual(2);
  });

  it('rate-limits notifications when the list really flips on each reconnect', async () => {
    h = await startServer();
    let m = await pairModule(h, 'uA', { userName: 'alice', isGM: true });
    modules.push(m);
    const s = await openSession(h, { user: 'alice' });
    sessions.push(s);
    await s.client.listTools();
    const base = s.listChanged.count;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      m = await reconnectModule(h, m, { isGM: i % 2 === 1 });
      modules.push(m);
    }
    const elapsed = Date.now() - t0;
    await tick(400);
    expect(s.listChanged.count - base).toBeLessThanOrEqual(Math.floor(elapsed / 250) + 2);
  });
});

describe('terminal-safe operator output', () => {
  it.each([['\x1b[2J'], ['\x1b]0;x\x07'], ['\nPairing code: FAKE-CODE']])(
    'logs the implicit bind as one clean line for a name or world containing %j',
    async (evil) => {
      h = await startServer();
      const a = await pairModule(h, 'uA', { userName: `al${evil}ice`, worldId: `w${evil}1` });
      modules.push(a);
      const lines: string[] = [];
      const s = await openSession(h, {}, undefined, 5000, { log: (l) => lines.push(l) });
      sessions.push(s);
      await s.client.listTools();
      expect(lines).toHaveLength(1);
      expect(lines[0]).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
      expect(lines[0]).toMatch(/^Bound MCP session to al/);
    },
  );

  it('caps a very long name in the log line', async () => {
    h = await startServer();
    const a = await pairModule(h, 'uA', { userName: 'n'.repeat(500) });
    modules.push(a);
    const lines: string[] = [];
    const s = await openSession(h, {}, undefined, 5000, { log: (l) => lines.push(l) });
    sessions.push(s);
    await s.client.listTools();
    expect(lines[0]!.length).toBeLessThan(200);
  });
});

describe('ambiguity messages', () => {
  it('tells the operator to restart with --user <id> when a name is permanently shared', async () => {
    h = await startServer();
    const s1 = await pairModule(h, 'uA', { userName: 'sam' });
    const s2 = await pairModule(h, 'uB', { userName: 'sam' });
    modules.push(s1, s2);
    const s = await openSession(h, { user: 'sam' });
    sessions.push(s);
    const res = await call(s);
    expectErrorCode(res, 'INVALID_ARGS');
    expect(JSON.stringify(res.content)).toContain(
      'restart the gateway with --world and --user <id>',
    );
  });
});

describe('store upgrade from version 1', () => {
  it('reads old pairings with an empty name: bindable by id, not by name', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ag-v1-')), 'g.db');
    const old = new DatabaseSync(path);
    old.exec(m001);
    old.exec('PRAGMA user_version = 1');
    old
      .prepare(
        'INSERT INTO pairings (id, token_hash, world_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run('p1', hashToken('old-token'), 'w1', 'uA', 1);
    old.close();

    const store = openStore(path);
    expect(store.findPairingByHash(hashToken('old-token'))?.userName).toBe('');
    // The pairing predates origin binding (migration 008 revoked it); revive and bind it to the test origin so this test stays about names.
    const bind = new DatabaseSync(path);
    bind
      .prepare('UPDATE pairings SET origin = ?, revoked_at = NULL WHERE id = ?')
      .run('http://localhost:30000', 'p1');
    bind.close();
    h = await startServer({ store });

    const tc = await (await import('../link/helpers.js')).TestClient.connect(h.port);
    tc.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      moduleVersion: '0',
      foundryVersion: '14',
      world: { id: 'w1', title: 'W', system: 's', systemVersion: '1' },
      user: { id: 'uA', name: 'alice', role: 1, isGM: false },
      auth: { kind: 'pairingToken', token: 'old-token' },
    });
    await tc.next('welcome');
    modules.push({
      tc,
      userId: 'uA',
      userName: '',
      worldId: 'w1',
      token: 'old-token',
      agentId: 'p1',
    });

    const byName = await openSession(h, { user: 'alice' });
    sessions.push(byName);
    expectErrorCode(await call(byName), 'WORLD_OFFLINE');
    await silent(modules[0]!);

    const byId = await openSession(h, { user: 'uA' });
    sessions.push(byId);
    const p = call(byId);
    const frame = (await tc.next('call')) as { id: string };
    tc.send({ type: 'result', id: frame.id, ok: true, text: 't', structured: { b: 'A' } });
    expect((await p).isError).toBeFalsy();
  });
});
