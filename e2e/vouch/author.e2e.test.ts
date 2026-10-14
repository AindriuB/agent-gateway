import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright-core';
import { asJoinPage, joinWorld, openUserBrowser, type UserBrowser } from '../lib/browser.js';
import { loadContext } from '../lib/context.js';

// Task 90 spike. Two facts the GM-vouched pairing rests on, checked on a live Foundry:
//  (1) a non-GM cannot create a ChatMessage authored as another user (the server enforces it), and
//  (2) a whispered, flagged ChatMessage from a player fires `createChatMessage` in the GM's
//      browser, where the GM can delete it.
// No gateway is involved: only the two stored browser profiles. Every message this suite makes
// carries the TAG below and is removed by the GM at the end.
const ctx = loadContext();
const { config, paths } = ctx;
const TAG = 'ag-vouch-spike';

let gm: UserBrowser;
let player: UserBrowser;
let gmId = '';
let playerId = '';

const idOf = (page: Page, name: string): Promise<string> =>
  page.evaluate((n) => {
    const g = (globalThis as unknown as { game: { users: Iterable<{ id: string; name: string }> } })
      .game;
    const want = n.trim().toLowerCase();
    for (const u of g.users) if (u.name.trim().toLowerCase() === want) return u.id;
    return '';
  }, name);

/** Stored messages the GM's own database copy holds, after a reload (server state). */
async function storedSpikeMessages(page: Page): Promise<{ id: string; author: string | null }[]> {
  await page.reload();
  await page.waitForFunction('globalThis.game?.ready === true', undefined, { timeout: 120_000 });
  return page.evaluate((tag) => {
    const g = globalThis as unknown as {
      game: { messages: Iterable<{ id: string; content: string; author?: { id: string } | null }> };
    };
    return [...g.game.messages]
      .filter((m) => String(m.content).startsWith(tag))
      .map((m) => ({ id: m.id, author: m.author?.id ?? null }));
  }, TAG);
}

beforeAll(async () => {
  gm = await openUserBrowser(config, paths, config.gmUser, { headed: config.headed });
  player = await openUserBrowser(config, paths, config.playerUser, { headed: config.headed });
  await joinWorld(asJoinPage(gm.page), config, config.gmUser);
  await joinWorld(asJoinPage(player.page), config, config.playerUser);
  gmId = await idOf(gm.page, config.gmUser);
  playerId = await idOf(player.page, config.playerUser);
}, 300_000);

afterAll(async () => {
  try {
    // Remove only what this suite made.
    await gm?.page.evaluate(async (tag) => {
      const g = globalThis as unknown as {
        game: { messages: Iterable<{ id: string; content: string }> };
        ChatMessage: { deleteDocuments(ids: string[]): Promise<unknown> };
      };
      const ids = [...g.game.messages]
        .filter((m) => String(m.content).startsWith(tag))
        .map((m) => m.id);
      if (ids.length) await g.ChatMessage.deleteDocuments(ids);
    }, TAG);
  } finally {
    await player?.close().catch(() => undefined);
    await gm?.close().catch(() => undefined);
  }
}, 60_000);

describe('vouch spike', () => {
  it('knows two distinct users', () => {
    expect(gmId).not.toBe('');
    expect(playerId).not.toBe('');
    expect(gmId).not.toBe(playerId);
  });

  it('(1) a player cannot author a ChatMessage as the GM, by API or by raw socket', async () => {
    const outcome = await player.page.evaluate(
      async ({ tag, forged }) => {
        const g = globalThis as unknown as {
          game: { socket: { emit(ev: string, req: unknown, cb: (r: unknown) => void): void } };
          ChatMessage: {
            create(d: unknown): Promise<{ id: string; author?: { id: string } } | undefined>;
          };
        };
        const out: Record<string, string> = {};
        try {
          const m = await g.ChatMessage.create({ content: `${tag}-api`, author: forged });
          out.api = `created author=${m?.author?.id ?? 'none'}`;
        } catch (e) {
          out.api = `threw: ${String((e as Error).message).slice(0, 160)}`;
        }
        out.socket = await new Promise<string>((resolve) => {
          const timer = setTimeout(() => resolve('no ack in 8s'), 8000);
          g.game.socket.emit(
            'modifyDocument',
            {
              action: 'create',
              type: 'ChatMessage',
              operation: {
                action: 'create',
                modifiedTime: Date.now(),
                data: [{ content: `${tag}-socket`, author: forged }],
                pack: null,
                parent: null,
                parentUuid: null,
                render: true,
                renderSheet: false,
                broadcast: true,
              },
            },
            (r) => {
              clearTimeout(timer);
              resolve(JSON.stringify(r).slice(0, 240));
            },
          );
        });
        return out;
      },
      { tag: TAG, forged: gmId },
    );
    process.stdout.write(`[vouch-spike] forge attempts: ${JSON.stringify(outcome)}\n`);

    const stored = await storedSpikeMessages(gm.page);
    process.stdout.write(`[vouch-spike] stored after GM reload: ${JSON.stringify(stored)}\n`);
    for (const m of stored) {
      expect(m.author, `message ${m.id} must not be authored as the GM`).toBe(playerId);
    }
  }, 120_000);

  it('(2) a whispered, flagged player message fires createChatMessage for the GM, who can delete it', async () => {
    await gm.page.evaluate(() => {
      const g = globalThis as unknown as {
        Hooks: { on(ev: string, fn: (m: unknown) => void): void };
        __vouchSeen?: { id: string; author: string; flag: unknown }[];
      };
      g.__vouchSeen = [];
      g.Hooks.on('createChatMessage', (m) => {
        const msg = m as { id: string; author?: { id: string }; flags?: Record<string, unknown> };
        g.__vouchSeen?.push({
          id: msg.id,
          author: msg.author?.id ?? '',
          flag: (msg.flags?.['agent-gateway'] as { vouch?: unknown } | undefined)?.vouch,
        });
      });
    });
    await player.page.evaluate(
      async ({ tag, gmId: g1 }) => {
        const g = globalThis as unknown as {
          ChatMessage: { create(d: unknown): Promise<unknown> };
        };
        await g.ChatMessage.create({
          content: `${tag}-whisper`,
          whisper: [g1],
          flags: { 'agent-gateway': { vouch: { nonce: 'spike-nonce' } } },
        });
      },
      { tag: TAG, gmId },
    );
    await gm.page.waitForFunction('globalThis.__vouchSeen?.some((s) => s.flag)', undefined, {
      timeout: 15_000,
    });
    const seen = (await gm.page.evaluate('globalThis.__vouchSeen')) as {
      id: string;
      author: string;
      flag: { nonce?: string };
    }[];
    process.stdout.write(
      `[vouch-spike] GM hook saw: ${JSON.stringify(seen.filter((s) => s.flag))}\n`,
    );
    const hit = seen.find((s) => s.flag);
    expect(hit?.author).toBe(playerId);
    expect(hit?.flag.nonce).toBe('spike-nonce');
    const gone = await gm.page.evaluate(async (id) => {
      const g = globalThis as unknown as {
        game: { messages: { get(id: string): { delete(): Promise<unknown> } | undefined } };
      };
      await g.game.messages.get(id)?.delete();
      return g.game.messages.get(id) === undefined;
    }, hit!.id);
    expect(gone).toBe(true);
  }, 60_000);
});
