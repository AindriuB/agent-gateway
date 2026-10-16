import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_IMAGE=1. Runs on whichever Foundry (v13 or v14) the test bed
// serves. The suite creates its own temporary scene, tile and two actors (one the player owns,
// one the player does not) and removes each by exact UUID in afterAll. Every `set` needs the
// human's approval. Native execution needs the repository owner's per-run approval.
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';

type Row = Record<string, unknown>;
type Entry = { path: string; name: string };

// Mirrors module/src/approvals/config.ts APPROVAL_TTL_MS; see e2e/pf2e/pf2e.e2e.test.ts.
const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;
const UUID_RE = /\b(?:Actor|Scene)\.[A-Za-z0-9]{16}\b/;

async function settle(session: UserSession, r: CallResult): Promise<CallResult> {
  if (r.structured?.status !== 'pending_approval') return r;
  const id = String(r.structured.id);
  for (;;) {
    const current = await session.gateway.call('approval_status', { id });
    if (current.isError) throw new Error(`approval_status ${id} failed: ${current.text}`);
    const status = current.structured?.status;
    if (status === 'approved' && typeof current.structured?.result === 'string')
      return {
        ...current,
        isError: current.structured?.resultFailed === true,
        text: String(current.structured?.result),
      };
    if (status === 'denied' || status === 'expired' || status === 'unknown')
      throw new Error(`approval ${id} ended ${String(status)}: ${current.text}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
}

describe('image_assign (set AGENT_GATEWAY_E2E_IMAGE=1)', () => {
  let gm: UserSession;
  let player: UserSession;
  let image: string | undefined;
  let sceneUuid: string | undefined;
  let tileUuid: string | undefined;
  let ownedUuid: string | undefined;
  let foreignUuid: string | undefined;
  const residue: string[] = [];

  /** Breadth-first search of the Data tree for any image, bounded in depth and calls. */
  async function findImage(): Promise<string> {
    const queue: string[] = [''];
    for (let calls = 0; queue.length > 0 && calls < 40; calls++) {
      const dir = queue.shift()!;
      const r = await gm.gateway.call('image_assign', { action: 'list', dir });
      if (r.isError) continue;
      const files = (r.structured?.files ?? []) as Entry[];
      if (files.length > 0) return files[0]!.path;
      queue.push(...((r.structured?.dirs ?? []) as Entry[]).map((d) => d.path));
    }
    throw new Error('no image found in the Foundry Data files');
  }

  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    gm.browser.page.evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>;

  const createActor = async (name: string, ownership: Row): Promise<string> => {
    const made = await settle(
      gm,
      await gm.gateway.call('document_create', {
        type: 'Actor',
        data: JSON.stringify({ name, type: 'character', ownership }),
      }),
    );
    expect(made.isError, made.text).toBe(false);
    const uuid = (made.structured?.uuid as string | undefined) ?? UUID_RE.exec(made.text)?.[0];
    expect(typeof uuid).toBe('string');
    residue.push(uuid!);
    return uuid!;
  };

  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    gm = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    player = await openUserSession(ctx.config, ctx.paths, ctx.config.playerUser);
    image = await findImage();
    // A scene and tile have no tool to create them, so the GM browser makes them natively.
    sceneUuid = await evalGm<string>(
      `async () => (await Scene.create({ name: 'agent-gateway e2e image (temporary)' })).uuid`,
      null,
    );
    tileUuid = await evalGm<string>(
      `async (u) => { const s = await fromUuid(u); const [t] = await s.createEmbeddedDocuments('Tile', [{ x: 0, y: 0, width: 100, height: 100 }]); return t.uuid; }`,
      sceneUuid,
    );
    ownedUuid = await createActor('agent-gateway e2e image owned (temporary)', { default: 3 });
    foreignUuid = await createActor('agent-gateway e2e image foreign (temporary)', { default: 0 });
  }, humanTimeout(2));

  afterAll(async () => {
    const failures: string[] = [];
    if (gm) {
      try {
        if (sceneUuid)
          await evalGm(`async (u) => { await (await fromUuid(u)).delete(); }`, sceneUuid);
      } catch (e) {
        failures.push(`Scene ${String(sceneUuid)}: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const uuid of residue) {
        try {
          const del = await settle(gm, await gm.gateway.call('document_delete', { uuids: [uuid] }));
          if (del.isError) throw new Error(del.text);
        } catch (e) {
          failures.push(`${uuid}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    for (const s of [player, gm])
      try {
        await s?.close();
      } catch (e) {
        failures.push(`close: ${e instanceof Error ? e.message : String(e)}`);
      }
    if (failures.length > 0) throw new Error(`RESIDUE: ${failures.join('; ')}`);
  }, humanTimeout(3));

  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });

  const set = (s: UserSession, target: string, uuid: string | undefined) =>
    s.gateway.call('image_assign', { action: 'set', path: image, target, uuid });

  it('GM lists a directory', async () => {
    const r = await gm.gateway.call('image_assign', { action: 'list' });
    expect(r.isError, r.text).toBe(false);
    expect(r.structured).toHaveProperty('files');
    expect(r.structured).toHaveProperty('dirs');
  });

  it(
    'GM sets a temporary scene background and tile texture',
    async () => {
      const bg = await settle(gm, await set(gm, 'scene_background', sceneUuid));
      expect(bg.isError, bg.text).toBe(false);
      expect(
        await evalGm<string>(`async (u) => (await fromUuid(u)).background.src`, sceneUuid),
      ).toBe(image);
      const tile = await settle(gm, await set(gm, 'tile', tileUuid));
      expect(tile.isError, tile.text).toBe(false);
      expect(await evalGm<string>(`async (u) => (await fromUuid(u)).texture.src`, tileUuid)).toBe(
        image,
      );
    },
    humanTimeout(2),
  );

  it(
    'a player sets the portrait and token art of an Actor they own',
    async () => {
      for (const target of ['actor_portrait', 'actor_token']) {
        const r = await settle(player, await set(player, target, ownedUuid));
        expect(r.isError, r.text).toBe(false);
      }
      const read = await evalGm<[string, string]>(
        `async (u) => { const a = await fromUuid(u); return [a.img, a.prototypeToken.texture.src]; }`,
        ownedUuid,
      );
      expect(read).toEqual([image, image]);
    },
    humanTimeout(2),
  );

  it('a player is refused on another user Actor and on GM-only targets', async () => {
    const other = await player.gateway.call('image_assign', {
      action: 'set',
      path: image,
      target: 'actor_portrait',
      uuid: foreignUuid,
    });
    expect(other.isError).toBe(true);
    expect(other.text).toMatch(/FORBIDDEN|own/);
    const tile = await set(player, 'tile', tileUuid);
    expect(tile.isError).toBe(true);
    expect(tile.text).toMatch(/FORBIDDEN|GM/);
  });
});
