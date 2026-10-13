import { afterEach, describe, expect, it } from 'vitest';
import { PairingCodes, PAIRING_CODE_TTL_MS } from '../../src/link/index.js';
import { startServer, type Harness } from '../link/helpers.js';
import {
  expectErrorCode,
  openSession,
  pairModule,
  until,
  type FakeModule,
  type McpSession,
} from '../routing/harness.js';

const ANY_CODE = /[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}/;

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

/** A code source on a clock the test moves; the timer never fires on its own. */
function codeSource() {
  const clock = { t: 0 };
  const codes = new PairingCodes({ now: () => clock.t, setTimer: () => 0, clearTimer: () => {} });
  const hint = () => {
    const c = codes.issue('mcp');
    return { code: c.code, expiresInMin: Math.ceil((c.expiresAt - clock.t) / 60_000) };
  };
  return { clock, codes, hint };
}

const fixture = (s: McpSession) =>
  s.client.callTool({ name: 'fixture_tool', arguments: { a: 'x' } });
const text = (r: unknown) =>
  ((r as { content: { text: string }[] }).content[0] ?? { text: '' }).text;
const status = (s: McpSession) => s.client.callTool({ name: 'gateway_status', arguments: {} });

describe('the pairing code in the chat', () => {
  it('an unbound call says how to pair and shows the live code; an expired code is replaced', async () => {
    h = await startServer();
    const src = codeSource();
    const s = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s);
    const res = await fixture(s);
    expectErrorCode(res, 'WORLD_OFFLINE');
    const first = src.codes.current()!.code;
    expect(text(res)).toBe(
      `WORLD_OFFLINE: Not connected to Foundry yet. Open your world in a browser and enter code ${first} in the Agent Gateway pairing prompt (expires in 10 min).`,
    );
    expect(text(await fixture(s))).toContain(first);
    src.clock.t = PAIRING_CODE_TTL_MS;
    const later = text(await fixture(s));
    const second = src.codes.current()!.code;
    expect(second).not.toBe(first);
    expect(later).toContain(second);
    expect(later).not.toContain(first);
    expect(src.codes.consume(first)).toBe(false);
  });

  it('a session bound to an offline pairing names it and still offers the code', async () => {
    h = await startServer();
    const src = codeSource();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const s = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s);
    await fixtureAnswer(a, fixture(s));
    a.tc.ws.terminate();
    await until(() => !h!.registry.get('w1', 'uA'));
    const res = await fixture(s);
    expectErrorCode(res, 'WORLD_OFFLINE');
    expect(text(res)).toMatch(
      /^WORLD_OFFLINE: world w1 \/ user alice is not connected\. Open that world in a browser as alice; to pair a different browser, enter code [A-Z2-9-]{9} in the Agent Gateway pairing prompt \(expires in 10 min\)\.$/,
    );
  });

  it('a link error on an in-flight call carries no code, and neither does ambiguity', async () => {
    h = await startServer();
    const src = codeSource();
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const s = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s);
    const pending = fixture(s);
    await a.tc.next('call');
    a.tc.ws.terminate();
    const res = await pending;
    expectErrorCode(res as Record<string, unknown>, 'WORLD_OFFLINE');
    expect(text(res)).not.toMatch(ANY_CODE);
    const b = await pairModule(h, 'uB', { userName: 'bob', worldId: 'w2' });
    const c = await pairModule(h, 'uC', { userName: 'carol', worldId: 'w3' });
    modules.push(b, c);
    const s2 = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s2);
    const amb = await fixture(s2);
    expectErrorCode(amb, 'INVALID_ARGS');
    expect(text(amb)).not.toMatch(ANY_CODE);
  });
});

const fixtureAnswer = async (m: FakeModule, p: Promise<unknown>) => {
  const frame = (await m.tc.next('call')) as { id: string };
  m.tc.send({ type: 'result', id: frame.id, ok: true, text: 'done', structured: { b: 'B' } });
  return p;
};

describe('gateway_status', () => {
  it('is listed unbound and bound, and never goes over the link', async () => {
    h = await startServer();
    const unbound = await openSession(h);
    sessions.push(unbound);
    const names = async (s: McpSession) => (await s.client.listTools()).tools.map((t) => t.name);
    expect(await names(unbound)).toContain('gateway_status');
    const tool = (await unbound.client.listTools()).tools.find((t) => t.name === 'gateway_status')!;
    expect(tool.inputSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const bound = await openSession(h);
    sessions.push(bound);
    expect(await names(bound)).toContain('gateway_status');
    await status(bound);
    expect(a.tc.messages.filter((m) => (m as { type?: string }).type === 'call')).toEqual([]);
  });

  it('not_connected carries the code; connected carries none, and no result then holds a code', async () => {
    h = await startServer();
    const src = codeSource();
    const s = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s);
    const before = await status(s);
    const code = src.codes.current()!.code;
    expect(before.structuredContent).toEqual({
      state: 'not_connected',
      pairingCode: code,
      codeExpiresInMin: 10,
    });
    expect(text(before)).toContain(code);

    const a = await pairModule(h, 'uA', { userName: 'alice' });
    modules.push(a);
    const connected = await status(s);
    expect(connected.structuredContent).toEqual({ state: 'connected', world: 'w1', user: 'alice' });
    expect(JSON.stringify(connected)).not.toMatch(ANY_CODE);
    const done = await fixtureAnswer(a, fixture(s));
    expect(JSON.stringify(done)).not.toMatch(ANY_CODE);
    expect(JSON.stringify((await s.client.listTools()).tools)).not.toContain(code);
  });

  it('ambiguous lists the candidates and offers no code', async () => {
    h = await startServer();
    const src = codeSource();
    modules.push(
      await pairModule(h, 'uA', { userName: 'alice' }),
      await pairModule(h, 'uB', { userName: 'bob', worldId: 'w2' }),
    );
    const s = await openSession(h, {}, undefined, 5000, { pairingHint: src.hint });
    sessions.push(s);
    const res = await status(s);
    expect(res.structuredContent).toEqual({
      state: 'ambiguous',
      candidates: ['world w1 / user alice', 'world w2 / user bob'],
    });
    expect(text(res)).not.toMatch(ANY_CODE);
  });
});
