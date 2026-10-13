import { createServer as createNetServer } from 'node:net';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS_TOOL } from '../../src/mcp/degraded.js';
import {
  FakeModule,
  freePort,
  pairedPrimary,
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
    expect(existsSync(join(state.dir, 'relay.sock'))).toBe(false);
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
});
