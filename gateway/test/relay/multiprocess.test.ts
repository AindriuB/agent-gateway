import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { createServer as createNetServer } from 'node:net';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS_TOOL } from '../../src/mcp/degraded.js';
import {
  cliPath,
  FakeModule,
  freePort,
  pairedPrimary,
  sleep,
  startCli,
  tempState,
  until,
  type Cli,
} from './harness.js';

const toolNames = async (c: Cli) => (await c.client.listTools()).tools.map((t) => t.name);
const echo = async (c: Cli, value: string) => {
  const r = await c.client.callTool({ name: 'demo-echo', arguments: { value } });
  return JSON.stringify(r.content);
};

describe('relay between built CLI instances', () => {
  const clis: Cli[] = [];
  const modules: FakeModule[] = [];
  const cleanups: (() => void)[] = [];
  const holders: ReturnType<typeof createNetServer>[] = [];
  afterEach(async () => {
    for (const m of modules.splice(0)) m.close();
    for (const c of clis.splice(0)) {
      await c.close();
    }
    for (const h of holders.splice(0)) await new Promise((r) => h.close(r));
    for (const f of cleanups.splice(0)) f();
  });
  const track = <T extends Cli>(c: T) => (clis.push(c), c);

  it('(a) a Cowork-style secondary lists the full tool set and calls a fixture tool', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: primary, module } = await pairedPrimary(port, state.db);
    clis.push(primary);
    modules.push(module);
    const dbBefore = statSync(state.db);

    const secondary = track(await startCli(port, state.db));
    const names = await toolNames(secondary);
    expect(names).not.toEqual([STATUS_TOOL]);
    expect(names).toContain('world_info');
    expect(names).toContain('demo-echo');
    expect(await echo(secondary, 'hi')).toContain('echo:hi');
    expect(await echo(primary, 'me')).toContain('echo:me');
    // Each relayed session is a full session of its own on the primary.
    const third = track(await startCli(port, state.db));
    expect(await echo(third, 'third')).toContain('echo:third');
    const ids = new Set(module.calls.map((c) => c.sessionId));
    expect(ids.size).toBe(3);
    expect(primary.stderr()).toMatch(/relay session 1 opened/);
    expect(secondary.stderr()).not.toContain('Pairing code');
    // A relay never opens the db.
    const dbAfter = statSync(state.db);
    expect([dbAfter.size, dbAfter.mtimeMs]).toEqual([dbBefore.size, dbBefore.mtimeMs]);
  }, 60_000);

  it('(d) bounded retry: a plain listener holding the port ends in the degraded server', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const holder = createNetServer();
    holders.push(holder);
    const port = await new Promise<number>((res) =>
      holder.listen(0, '127.0.0.1', () => res((holder.address() as { port: number }).port)),
    );
    const started = Date.now();
    const secondary = track(await startCli(port, state.db));
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(await toolNames(secondary)).toEqual([STATUS_TOOL]);
    const res = await secondary.client.callTool({ name: STATUS_TOOL, arguments: {} });
    const text = JSON.stringify(res.content);
    expect(text).toContain('LINK_UNAVAILABLE');
    expect(text).toMatch(/after 10 attempts/);
    expect(text).toContain('cannot read relay secret');
    expect(existsSync(join(state.dir, `relay-${port}.sock`))).toBe(false);
  }, 60_000);

  it('(c) takeover: killing the primary leaves exactly one new holder and both clients recover', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: primary, module } = await pairedPrimary(port, state.db);
    clis.push(primary);
    module.keepAlive();
    modules.push(module);
    const s1 = track(await startCli(port, state.db));
    const s2 = track(await startCli(port, state.db));
    expect(await echo(s1, 'one')).toContain('echo:one');
    expect(await echo(s2, 'two')).toContain('echo:two');

    // An in-flight call at kill time gets RELAY_LOST.
    module.hang = 'stuck';
    const inflight = s1.client.callTool({ name: 'demo-echo', arguments: { value: 'stuck' } }).then(
      () => 'ok',
      (e: Error) => e.message,
    );
    await until(() => module.calls.some((c) => c.value === 'stuck'), 10_000, 'in-flight call');
    process.kill(primary.pid, 'SIGKILL');
    expect(await inflight).toContain('RELAY_LOST');

    await until(() => s1.listChanged() >= 1 && s2.listChanged() >= 1, 15_000, 'list_changed');
    const holders = [s1, s2].filter((c) => /Pairing code: /.test(c.stderr()));
    expect(holders).toHaveLength(1);
    module.hang = undefined;
    await until(() => module.ready, 15_000, 'module reconnect');
    expect(await toolNames(s1)).toContain('demo-echo');
    expect(await echo(s1, 'again1')).toContain('echo:again1');
    expect(await echo(s2, 'again2')).toContain('echo:again2');
  }, 90_000);

  it('(c2) a large request in flight when the primary dies does not wedge the client', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: primary, module } = await pairedPrimary(port, state.db);
    clis.push(primary);
    module.keepAlive();
    modules.push(module);
    const s1 = track(await startCli(port, state.db));
    expect(await echo(s1, 'warm')).toContain('echo:warm');
    const big = 'x'.repeat(600_000);
    module.hang = big;
    const inflight = s1.client.callTool({ name: 'demo-echo', arguments: { value: big } }).then(
      () => 'ok',
      (e: Error) => e.message,
    );
    await until(() => module.calls.some((c) => c.value === big), 10_000, 'big call');
    process.kill(primary.pid, 'SIGKILL');
    expect(await inflight).toContain('RELAY_LOST');
    module.hang = undefined;
    await until(() => s1.listChanged() >= 1, 15_000, 'list_changed');
    await until(() => module.ready, 15_000, 'module reconnect');
    expect(await echo(s1, 'after')).toContain('echo:after');
  }, 90_000);

  it('(c3) a taken-over instance survives a 5 MiB id-last request; the fleet keeps working', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: primary, module } = await pairedPrimary(port, state.db);
    clis.push(primary);
    module.keepAlive();
    modules.push(module);
    const s1 = track(await startCli(port, state.db));
    const s2 = track(await startCli(port, state.db));
    process.kill(primary.pid, 'SIGKILL');
    await until(() => s1.listChanged() >= 1 && s2.listChanged() >= 1, 15_000, 'takeover');
    await until(() => module.ready, 15_000, 'module reconnect');
    // The SDK writes `id` last, so the id sits after the oversized params.
    const huge = 'x'.repeat(5 * 1024 * 1024);
    for (const c of [s1, s2]) {
      const err = await c.client.callTool({ name: 'demo-echo', arguments: { value: huge } }).then(
        () => 'ok',
        (e: Error) => e.message,
      );
      expect(err).toContain('request line over');
    }
    expect(await echo(s1, 'next1')).toContain('echo:next1');
    expect(await echo(s2, 'next2')).toContain('echo:next2');
    expect(existsSync(join(state.dir, `relay-${port}.sock`))).toBe(true);
    expect(existsSync(join(state.dir, `relay-${port}.secret`))).toBe(true);
    expect(s1.stderr() + s2.stderr()).not.toContain('already holds the link');
    // A third instance can still join the new primary's relay.
    const s3 = track(await startCli(port, state.db));
    expect(await echo(s3, 'late')).toContain('echo:late');
  }, 90_000);

  it('(e) a newer instance with different settings replaces a stale primary', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    // The install-time instance: manifest defaults (player, default origins).
    const stale = await startCli(port, state.db, [], true, { AGENT_GATEWAY_ROLE: 'player' });
    clis.push(stale);
    await until(() => /Pairing code: /.test(stale.stderr()), 10_000, 'stale primary');
    const exited = new Promise<void>((res) => {
      const t = setInterval(() => {
        try {
          process.kill(stale.pid, 0);
        } catch {
          clearInterval(t);
          res();
        }
      }, 50);
    });
    // The user saved new settings: a restarted instance with role gm and a new origin.
    const fresh = track(
      await startCli(port, state.db, ['--allow-origin=https://foundry.local'], true, {
        AGENT_GATEWAY_ROLE: 'gm',
      }),
    );
    await Promise.race([
      exited,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('stale primary did not exit')), 15_000),
      ),
    ]);
    expect(stale.stderr()).toContain('stepping down');
    // The fresh instance holds the port with its own config, and the browser origin is accepted.
    await until(() => /Pairing code: /.test(fresh.stderr()), 15_000, 'fresh primary');
    expect(fresh.stderr()).toContain(`pid ${fresh.pid} holds link port ${port}`);
    expect(await fresh.client.listTools().then((t) => t.tools.length)).toBeGreaterThan(1);
    // A later instance with the same settings relays to it, with the same config.
    const same = track(
      await startCli(port, state.db, ['--allow-origin=https://foundry.local'], true, {
        AGENT_GATEWAY_ROLE: 'gm',
      }),
    );
    const names = (await same.client.listTools()).tools.map((t) => t.name);
    expect(names).not.toEqual([STATUS_TOOL]);
    expect(same.stderr()).not.toContain('Pairing code');
  }, 90_000);

  it('(f) gateways on different link ports can share one state dir', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const portA = await freePort();
    const portB = await freePort();
    const dbA = join(state.dir, 'a.db');
    const dbB = join(state.dir, 'b.db');
    const a = track(await startCli(portA, dbA));
    const b = track(await startCli(portB, dbB));
    await until(() => /Pairing code/.test(a.stderr()) && /Pairing code/.test(b.stderr()), 10_000);
    const a2 = track(await startCli(portA, dbA));
    const b2 = track(await startCli(portB, dbB));
    for (const c of [a2, b2]) expect(await toolNames(c)).not.toEqual([STATUS_TOOL]);
    expect(existsSync(join(state.dir, `relay-${portA}.sock`))).toBe(true);
    expect(existsSync(join(state.dir, `relay-${portB}.sock`))).toBe(true);
    // Stopping A's primary does not disturb B's endpoint or its relays.
    process.kill(a.pid, 'SIGTERM');
    await until(() => a2.listChanged() >= 1, 15_000, 'A takeover');
    expect(existsSync(join(state.dir, `relay-${portB}.sock`))).toBe(true);
    expect(await toolNames(b2)).not.toEqual([STATUS_TOOL]);
    const b3 = track(await startCli(portB, dbB));
    expect(await toolNames(b3)).not.toEqual([STATUS_TOOL]);
  }, 90_000);

  it('(g) a secondary whose client never reads stdout stays bounded and does not affect others', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const { cli: primary, module } = await pairedPrimary(port, state.db);
    clis.push(primary);
    modules.push(module);
    const healthy = track(await startCli(port, state.db));
    const stuck = spawn(
      process.execPath,
      [cliPath, '--link-port', String(port), '--db', state.db],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', HOME: tmpdir() } },
    );
    stuck.stdout.pause(); // never reads
    stuck.stdin.on('error', () => undefined);
    stuck.stderr.resume();
    const send = (m: object) => stuck.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (let i = 1; i <= 3000; i++) send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
    // Meanwhile the primary and a healthy relayed session keep working.
    for (let n = 0; n < 5; n++) {
      expect(await echo(healthy, `ok${n}`)).toContain(`echo:ok${n}`);
      expect(await echo(primary, `p${n}`)).toContain(`echo:p${n}`);
      await sleep(200);
    }
    // The stuck process is either parked or has dropped the client; it is not growing without bound.
    const rss = Number(
      execFileSync('ps', ['-o', 'rss=', '-p', String(stuck.pid)], { encoding: 'utf8' }).trim() || 0,
    );
    if (rss) expect(rss / 1024).toBeLessThan(400);
    stuck.kill();
    await new Promise((r) => stuck.once('close', r));
  }, 90_000);

  it('(h) the primary whose own client never reads stdout stays bounded and keeps serving relays', async () => {
    const state = tempState();
    cleanups.push(state.cleanup);
    const port = await freePort();
    const stuck = spawn(
      process.execPath,
      [cliPath, '--link-port', String(port), '--db', state.db],
      { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '', HOME: tmpdir() } },
    );
    let err = '';
    stuck.stderr.on('data', (d: Buffer) => (err += d.toString()));
    stuck.stdout.pause(); // never reads
    stuck.stdin.on('error', () => undefined);
    await until(() => /Pairing code: /.test(err), 10_000, 'pairing code');
    const module = new FakeModule(port);
    await module.connect({ code: /Pairing code: (\S+)/.exec(err)![1]! });
    modules.push(module);
    const send = (m: object) => stuck.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    for (let i = 1; i <= 3000; i++) send({ jsonrpc: '2.0', id: i, method: 'tools/list' });
    const healthy = track(await startCli(port, state.db));
    for (let n = 0; n < 5; n++) {
      expect(await echo(healthy, `ok${n}`)).toContain(`echo:ok${n}`);
      await sleep(200);
    }
    expect(stuck.exitCode).toBeNull(); // the primary keeps serving other instances
    const rss = Number(
      execFileSync('ps', ['-o', 'rss=', '-p', String(stuck.pid)], { encoding: 'utf8' }).trim() || 0,
    );
    expect(rss / 1024).toBeLessThan(400);
    stuck.kill();
    await new Promise((r) => stuck.once('close', r));
  }, 90_000);
});
