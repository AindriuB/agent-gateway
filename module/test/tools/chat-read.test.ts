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
    const oldest = first.structured.messages[0];
    expect(first.structured.nextBefore).toBe(`${oldest.timestamp}.${oldest.id}`);
  });

  it('rejects a malformed before cursor', async () => {
    setup([msg()]);
    for (const before of ['m1', 'abc.m1', '12', '.m1', '12.']) {
      expect(await read({ before })).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    }
  });

  it('pages correctly when the anchor message was deleted', async () => {
    const all = Array.from({ length: 8 }, (_, i) => msg({ content: `<p>c${i}</p>` }));
    setup(all);
    const first = await read({ limit: 3 });
    expect(first.structured.messages.map((m: any) => m.content)).toEqual(['c5', 'c6', 'c7']);
    // The anchor (c5) is deleted before the next call.
    (globalThis as any).game.messages.contents = all.filter((m) => m.content !== '<p>c5</p>');
    const second = await read({ limit: 3, before: first.structured.nextBefore });
    expect(second.structured.messages.map((m: any) => m.content)).toEqual(['c2', 'c3', 'c4']);
    const third = await read({ limit: 3, before: second.structured.nextBefore });
    expect(third.structured.messages.map((m: any) => m.content)).toEqual(['c0', 'c1']);
    expect(third.structured.nextBefore).toBeUndefined();
  });

  it('an anchor that is not visible or never existed reveals nothing extra', async () => {
    setup([
      msg({ content: '<p>a</p>' }),
      msg({ whisper: ['u2'], content: '<p>hid</p>' }),
      msg({ content: '<p>c</p>' }),
    ]);
    const r = await read({ before: '1002.m2' });
    expect(r.structured.messages.map((m: any) => m.content)).toEqual(['a']);
    expect(await read({ before: '1002.nothing' })).toEqual(r);
  });

  it('nextBefore points at a visible message only', async () => {
    setup([
      msg({ content: '<p>a</p>' }),
      msg({ whisper: ['u2'], content: '<p>hid</p>' }),
      msg({ content: '<p>c</p>' }),
      msg({ content: '<p>d</p>' }),
    ]);
    const r = await read({ limit: 2 });
    expect(r.structured.nextBefore).toBe('1003.m3');
    expect(JSON.stringify(r)).not.toContain('hid');
  });

  describe('blind rolls', () => {
    const blind = (whisper: string[]) =>
      msg({
        author: { id: 'u1' },
        blind: true,
        whisper,
        content: '<p>blind-secret</p>',
        rolls: [{ formula: '7d6+3', total: 24 }],
      });
    const leaks = (r: any) => /blind-secret|7d6|24/.test(JSON.stringify(r));

    it.each([
      ['whispered to the GM', ['gm']],
      ['not whispered', []],
    ] as const)(
      'author of a blind roll %s sees no content, formula or total',
      async (_n, whisper) => {
        setup([blind([...whisper]), msg({ content: '<p>pub</p>' })]);
        const r = await read({}, player);
        expect(r.structured.messages.map((m: any) => m.content)).toEqual(['pub']);
        expect(leaks(r)).toBe(false);
      },
    );

    it.each([
      ['whispered to the GM', ['gm']],
      ['not whispered', []],
    ] as const)('another player sees nothing of a blind roll %s', async (_n, whisper) => {
      setup([blind([...whisper])]);
      const r = await read({}, { id: 'u3', isGM: false });
      expect(r.structured.messages).toEqual([]);
      expect(leaks(r)).toBe(false);
    });

    it('a blind roll whispered to GM1 only is visible to GM1 and not to GM2', async () => {
      setup([blind(['gm1'])]);
      const one = await read({}, { id: 'gm1', isGM: true });
      expect(one.structured.messages[0]).toMatchObject({ content: 'blind-secret', rollTotal: 24 });
      const two = await read({}, { id: 'gm2', isGM: true });
      expect(two.structured.messages).toEqual([]);
      expect(leaks(two)).toBe(false);
    });

    it.each([
      ['whispered to the GM', ['gm']],
      ['not whispered', []],
    ] as const)(
      'a GM sees a blind roll %s with content, formula and total',
      async (_n, whisper) => {
        setup([blind([...whisper])]);
        const r = await read({}, gm);
        expect(r.structured.messages[0]).toMatchObject({
          content: 'blind-secret',
          rollFormula: '7d6+3',
          rollTotal: 24,
        });
      },
    );
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
