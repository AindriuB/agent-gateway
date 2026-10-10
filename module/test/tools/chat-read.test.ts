// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import type { OpCall } from '../../src/ops/types.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const agent = { id: 'a1', ownerUserId: 'u1', headless: false };
const call = (args: unknown): OpCall => ({ tool: 'chat_read', args, agent, sessionId: 's' });
const player = { id: 'u1', isGM: false };
const gm = { id: 'gm', isGM: true };

let n = 0;
const msg = (over: Record<string, unknown> = {}) => ({
  id: `m${++n}`,
  timestamp: 1000 + n,
  author: { id: 'u2' },
  speaker: { alias: 'Bob' },
  content: '<p>hi</p>',
  whisper: [],
  blind: false,
  rolls: [],
  flags: {},
  ...over,
});

function setup(messages: any[]) {
  n = 0;
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.users = {
    get: (id: string) => ({ u1: { id: 'u1', name: 'Pat' }, u2: { id: 'u2', name: 'Quinn' } })[id],
  };
  g.game.messages = { contents: messages };
}

const read = async (args: unknown, user = player) => (await dispatch(call(args), user)) as any;

describe('chat_read', () => {
  it('returns speaker, timestamp, markdown content, roll data and aiAuthored', async () => {
    setup([
      msg({ content: '<p>I <b>attack</b></p>', rolls: [{ formula: '1d20+5', total: 17 }] }),
      msg({ speaker: {}, author: { id: 'u2' }, flags: { 'agent-gateway': { ai: true } } }),
    ]);
    const r = await read({});
    const [a, b] = r.structured.messages;
    expect(a).toMatchObject({
      speaker: 'Bob',
      timestamp: 1001,
      content: 'I **attack**',
      rollFormula: '1d20+5',
      rollTotal: 17,
      aiAuthored: false,
      truncated: false,
    });
    expect(b.speaker).toBe('Quinn');
    expect(b.aiAuthored).toBe(true);
    expect(b.rollFormula).toBeUndefined();
  });

  it('aiAuthored is true only for ai === true', async () => {
    setup([
      msg({ flags: { 'agent-gateway': { ai: 'yes' } } }),
      msg({ flags: { other: { ai: true } } }),
      msg({ flags: { 'agent-gateway': { ai: true } } }),
    ]);
    const r = await read({});
    expect(r.structured.messages.map((m: any) => m.aiAuthored)).toEqual([false, false, true]);
  });

  it('excludes whispers to others, blind rolls for players; keeps own and addressed', async () => {
    setup([
      msg({ whisper: ['u2', 'u3'], content: '<p>secret</p>' }),
      msg({ whisper: ['u1'], content: '<p>for you</p>' }),
      msg({ author: { id: 'u1' }, whisper: ['u3'], content: '<p>mine</p>' }),
      msg({ blind: true, content: '<p>blind</p>' }),
      msg({ content: '<p>public</p>' }),
    ]);
    const r = await read({});
    const texts = r.structured.messages.map((m: any) => m.content);
    expect(texts).toEqual(['for you', 'mine', 'public']);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(JSON.stringify(r)).not.toContain('blind');
    const g = await read({}, gm);
    expect(g.structured.messages.map((m: any) => m.content)).toEqual(['blind', 'public']);
  });

  it('limit defaults to 20, max 100, newest first window in oldest-first order', async () => {
    setup(Array.from({ length: 150 }, () => msg()));
    expect((await read({})).structured.messages).toHaveLength(20);
    const r = await read({ limit: 100 });
    expect(r.structured.messages).toHaveLength(100);
    expect(r.structured.messages.at(-1).id).toBe('m150');
    expect(await dispatch(call({ limit: 101 }), player)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
  });

  it('pages back with before / nextBefore, skipping hidden messages', async () => {
    const all = Array.from({ length: 10 }, (_, i) =>
      msg({ content: `<p>c${i}</p>`, whisper: i % 3 === 0 ? ['u2'] : [] }),
    );
    setup(all);
    const first = await read({ limit: 3 });
    expect(first.structured.messages.map((m: any) => m.content)).toEqual(['c5', 'c7', 'c8']);
    const second = await read({ limit: 3, before: first.structured.nextBefore });
    expect(second.structured.nextBefore).toBeUndefined();
    const seen = [first, second].flatMap((r) => r.structured.messages.map((m: any) => m.content));
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain('c0');
    expect(seen).not.toContain('c3');
    expect(seen).toEqual(expect.arrayContaining(['c1', 'c2', 'c4', 'c5', 'c7', 'c8']));
    expect(first.structured.nextBefore).toBe(first.structured.messages[0].id);
  });

  it('before must be a visible message', async () => {
    setup([msg({ whisper: ['u2'] }), msg()]);
    const r = await read({ before: 'm1' });
    expect(r.structured.error).toBe('Message not found.');
    expect((await read({ before: 'nope' })).structured.messages).toEqual([]);
  });

  it('treats content as untrusted: no raw HTML or live links in output', async () => {
    setup([
      msg({
        speaker: { alias: '*x* <img src=x onerror=1>' },
        content:
          '<p>[a](javascript:alert(1)) <script>alert(1)</script><img src=x onerror=alert(1)></p><p># not heading</p>',
      }),
    ]);
    const r = await read({});
    const m = r.structured.messages[0];
    expect(m.content).not.toMatch(/<script|<img|alert\(1\)<|onerror/);
    expect(m.content).toContain('\\[a\\]');
    expect(r.text).not.toMatch(/<img/);
    expect(r.text).toContain('\\*x\\*');
  });

  it('caps long content and says so', async () => {
    setup([msg({ content: `<p>${'word '.repeat(2000)}</p>` })]);
    const m = (await read({})).structured.messages[0];
    expect(m.truncated).toBe(true);
    expect(m.content.length).toBeLessThan(2100);
  });

  it('no flags of other modules leave the module', async () => {
    setup([msg({ flags: { evil: { secret: 'leak' }, 'agent-gateway': { ai: true } } })]);
    expect(JSON.stringify(await read({}))).not.toContain('leak');
  });
});
