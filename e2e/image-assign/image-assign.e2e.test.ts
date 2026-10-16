import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { foundryVersion } from '../lib/browser.js';
import type { CallResult, GatewayProcess } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { RECONNECT_MS, Rig } from '../multi/rig.js';

// Opt-in: set AGENT_GATEWAY_E2E_IMAGE=1. Runs on whichever Foundry (v13 or v14) the test bed
// serves. One Rig keeps the GM and player browsers open; the gateway is bound to one user at a
// time and swapped only when a test needs the other. The suite creates its own temporary scene,
// tile and two actors (one the player owns, one the player does not) natively in the GM page and
// removes each by exact UUID there in afterAll. Every `set` needs the
// human's approval. Native execution needs the repository owner's per-run approval.
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';

type Entry = { path: string; name: string };

// Mirrors module/src/approvals/config.ts APPROVAL_TTL_MS; see e2e/pf2e/pf2e.e2e.test.ts.
const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;
/** A test that may swap the gateway once on top of its approvals. */
const swapTimeout = (approvals: number): number => humanTimeout(approvals) + RECONNECT_MS;

/** Settles an approval on the gateway that made the call. */
async function settle(gateway: GatewayProcess, r: CallResult): Promise<CallResult> {
  if (r.structured?.status !== 'pending_approval') return r;
  const id = String(r.structured.id);
  for (;;) {
    const current = await gateway.call('approval_status', { id });
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

/**
 * Reads, on the player's own page, the player's real level on each fixture. pf2e forces a
 * `character` Actor's default ownership to LIMITED at creation, so a fixture's assumed level is
 * checked rather than trusted. Waits for the document to arrive, then reports the levels.
 */
const PLAYER_LEVELS = `async (uuids) => {
  const out = {};
  for (const uuid of uuids) {
    let d = null;
    for (let i = 0; i < 40 && !d; i++) {
      d = await fromUuid(uuid).catch(() => null);
      if (!d) await new Promise((r) => setTimeout(r, 250));
    }
    out[uuid] = d && {
      owner: d.testUserPermission(game.user, 'OWNER') === true,
      limited: d.testUserPermission(game.user, 'LIMITED') === true,
      hidden: d.hidden === true,
      isOwner: d.isOwner === true,
    };
  }
  return out;
}`;
type Levels = Record<
  string,
  { owner: boolean; limited: boolean; hidden: boolean; isOwner: boolean } | null
>;

describe('image_assign (set AGENT_GATEWAY_E2E_IMAGE=1)', () => {
  let rig: Rig | undefined;
  let gmUser = '';
  let playerUser = '';
  let bound: string | undefined;
  let version = '';
  let image: string | undefined;
  let sceneUuid: string | undefined;
  let tileUuid: string | undefined;
  let ownedUuid: string | undefined;
  let foreignUuid: string | undefined;
  /** Every temporary document, by the exact UUID recorded at creation. */
  const created: string[] = [];
  // The world's core `permissions` setting (role lists per permission), snapshotted by the GM.
  let permissionSnapshot: Record<string, number[]> | undefined;
  let grantSkipReason: string | undefined;

  const pageOf = (user: string) => rig!.users.get(user)!.browser.page;
  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    pageOf(gmUser).evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>;
  /** The gateway bound to `user`; swaps only when the binding differs. */
  const as = async (user: string): Promise<GatewayProcess> => {
    if (bound !== user) {
      bound = undefined; // a swap that fails partway leaves the binding unknown
      await rig!.swap(user);
      bound = user;
    }
    const gw = rig!.gateway!;
    const info = await gw.call('world_info');
    expect(info.isError, `world_info as ${user}: ${info.text}`).toBe(false);
    expect(info.structured?.userName, `gateway is bound to the wrong user: ${info.text}`).toBe(
      user,
    );
    expect(
      ['GAMEMASTER', 'ASSISTANT'].includes(String(info.structured?.userRole)),
      `isGM mismatch for ${user} (role ${String(info.structured?.userRole)})`,
    ).toBe(user === gmUser);
    return gw;
  };

  /** Breadth-first search of the Data tree for any image, bounded in depth and calls. */
  async function findImage(): Promise<string> {
    const gw = await as(gmUser);
    const queue: string[] = [''];
    for (let calls = 0; queue.length > 0 && calls < 40; calls++) {
      const dir = queue.shift()!;
      const r = await gw.call('image_assign', { action: 'list', dir });
      if (r.isError) continue;
      const files = (r.structured?.files ?? []) as Entry[];
      if (files.length > 0) return files[0]!.path;
      queue.push(...((r.structured?.dirs ?? []) as Entry[]).map((d) => d.path));
    }
    throw new Error('no image found in the Foundry Data files');
  }

  /** Creates a document natively in the GM page and records its UUID for afterAll. */
  const createDoc = async (expr: string, arg: unknown): Promise<string> => {
    const uuid = await evalGm<string>(expr, arg);
    expect(typeof uuid).toBe('string');
    created.push(uuid);
    return uuid;
  };
  const PERMISSIONS = `game.settings.get('core', 'permissions')`;
  const writePermissions = (value: Record<string, number[]>): Promise<void> =>
    evalGm<void>(`async (v) => { await game.settings.set('core', 'permissions', v); }`, value);
  const browseRoles = (): number[] => permissionSnapshot?.FILES_BROWSE ?? [2, 3, 4];
  /** Waits for the player's own client to see its FILES_BROWSE permission become `want`. */
  const playerCanBrowse = (want: boolean): Promise<boolean> =>
    pageOf(playerUser).evaluate(
      `(async (want) => {
        for (let i = 0; i < 40; i++) {
          if (game.user.can('FILES_BROWSE') === want) return true;
          await new Promise((r) => setTimeout(r, 250));
        }
        return game.user.can('FILES_BROWSE') === want;
      })(${JSON.stringify(want)})`,
    ) as Promise<boolean>;
  const grantBrowse = async (): Promise<boolean> => {
    await writePermissions({
      ...permissionSnapshot!,
      FILES_BROWSE: [...new Set([...browseRoles(), 1])],
    });
    return playerCanBrowse(true);
  };
  const needGrant = (ctx: { skip: (reason?: string) => never }): void => {
    if (grantSkipReason) ctx.skip(grantSkipReason);
  };

  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    gmUser = ctx.config.gmUser;
    playerUser = ctx.config.playerUser;
    rig = new Rig(ctx);
    await rig.open(gmUser, [gmUser, playerUser]);
    bound = gmUser;
    version = await foundryVersion(pageOf(gmUser));
    image = await findImage();
    // Players lack FILES_BROWSE by default (Trusted+), so grant it for the run; afterAll restores.
    permissionSnapshot = await evalGm<Record<string, number[]>>(
      `async () => JSON.parse(JSON.stringify(${PERMISSIONS}))`,
      null,
    );
    expect(permissionSnapshot, 'core.permissions setting').toBeTypeOf('object');
    if (!(await grantBrowse())) {
      // On v13 the Player role can be granted browse, so a failed grant means a wrong key.
      if (!version.startsWith('14'))
        throw new Error(
          `FILES_BROWSE grant to role 1 had no effect on Foundry ${version}; check the core.permissions key`,
        );
      grantSkipReason = `Foundry ${version} did not grant FILES_BROWSE to the Player role (role 1)`;
    }
    // A scene and tile have no tool to create them, so the GM browser makes them natively.
    sceneUuid = await createDoc(
      `async () => (await Scene.create({ name: 'agent-gateway e2e image (temporary)' })).uuid`,
      null,
    );
    tileUuid = await createDoc(
      `async (u) => { const s = await fromUuid(u); const [t] = await s.createEmbeddedDocuments('Tile', [{ x: 0, y: 0, width: 100, height: 100 }]); return t.uuid; }`,
      sceneUuid,
    );
    // As in the real world: explicit per-user OWNER for the player. pf2e forces default ownership to
    // LIMITED on a character, so the player's real level is checked below.
    ownedUuid = await createDoc(
      `async (d) => { const u = game.users.getName(d.player); if (!u) throw new Error('no player user ' + d.player); return (await Actor.create({ name: d.name, type: 'character', ownership: { default: 0, [u.id]: 3 } })).uuid; }`,
      { name: 'agent-gateway e2e image owned (temporary)', player: playerUser },
    );

    // The player's own client must see the Actor as OWNER before any tool call.
    expect(
      await pageOf(playerUser).evaluate(
        `(async (uuid) => {
          for (let i = 0; i < 40; i++) {
            const a = await fromUuid(uuid);
            if (a && a.testUserPermission(game.user, 'OWNER') === true) return true;
            await new Promise((r) => setTimeout(r, 250));
          }
          return false;
        })(${JSON.stringify(ownedUuid)})`,
      ),
      'player client sees the owned Actor as OWNER',
    ).toBe(true);
    // An npc keeps the ownership it is given; a character is forced to default LIMITED by pf2e.
    foreignUuid = await createDoc(`async (d) => (await Actor.create(d)).uuid`, {
      name: 'agent-gateway e2e image foreign (temporary)',
      type: 'npc',
      ownership: { default: 0 },
    });
    const levels = (await pageOf(playerUser).evaluate(
      `(${PLAYER_LEVELS})(${JSON.stringify([ownedUuid, foreignUuid])})`,
    )) as Levels;
    expect(levels[ownedUuid]?.owner, 'fixture is not OWNER for the player (owned Actor)').toBe(
      true,
    );
    expect(
      levels[foreignUuid]?.limited,
      'fixture is not NONE for the player (foreign Actor): it grants LIMITED or more',
    ).toBe(false);
  }, 15 * 60_000);

  afterAll(async () => {
    const failures: string[] = [];
    const gmOpen = rig?.users.has(gmUser) === true;
    if (gmOpen && permissionSnapshot) {
      try {
        await writePermissions(permissionSnapshot);
        const back = await evalGm<unknown>(
          `async () => JSON.parse(JSON.stringify(${PERMISSIONS}))`,
          null,
        );
        expect(back, 'permissions restored to the snapshot').toEqual(permissionSnapshot);
      } catch (e) {
        failures.push(
          `RESIDUE: file permissions were not restored: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (created.length && !gmOpen)
      failures.push(
        `RESIDUE: temporary documents ${created.join(', ')} may still exist: no GM page`,
      );
    if (gmOpen) {
      // Reverse order, so the embedded Tile goes before its Scene.
      for (const uuid of [...created].reverse()) {
        try {
          await evalGm(`async (u) => { await (await fromUuid(u))?.delete(); }`, uuid);
        } catch (e) {
          failures.push(
            `RESIDUE: temporary document ${uuid} may still exist: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }
    try {
      await rig?.close();
    } catch (e) {
      failures.push(`RESIDUE: close: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
  }, 15 * 60_000);

  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });

  /** Calls image_assign set as `user` and settles on the gateway that made the call. */
  const set = async (user: string, target: string, uuid: string | undefined) => {
    const gw = await as(user);
    return settle(gw, await gw.call('image_assign', { action: 'set', path: image, target, uuid }));
  };

  // GM tests first, then the player tests, so the gateway swaps once.
  it('GM lists a directory', async () => {
    const gw = await as(gmUser);
    const r = await gw.call('image_assign', { action: 'list' });
    expect(r.isError, r.text).toBe(false);
    expect(r.structured).toHaveProperty('files');
    expect(r.structured).toHaveProperty('dirs');
  });

  it(
    'GM sets a temporary scene background and tile texture',
    async () => {
      const bg = await set(gmUser, 'scene_background', sceneUuid);
      expect(bg.isError, bg.text).toBe(false);
      expect(
        await evalGm<string>(`async (u) => (await fromUuid(u)).background.src`, sceneUuid),
      ).toBe(image);
      const tile = await set(gmUser, 'tile', tileUuid);
      expect(tile.isError, tile.text).toBe(false);
      expect(await evalGm<string>(`async (u) => (await fromUuid(u)).texture.src`, tileUuid)).toBe(
        image,
      );
    },
    humanTimeout(2),
  );

  it(
    'v14: Undo of the GM scene_background set restores the Level previous background.src',
    async (ctx) => {
      if (!version.startsWith('14')) return ctx.skip();
      const levelBackground = `async (u) => { const s = await fromUuid(u); const l = s.initialLevel ?? s.levels.contents[0]; return [l.uuid, l.background?.src ?? null]; }`;
      // The earlier test left the image in place; reset the Level natively so Undo has a different
      // value to restore, and read it back as the expected "previous".
      await evalGm(
        `async (u) => { const s = await fromUuid(u); const l = s.initialLevel ?? s.levels.contents[0]; await s.updateEmbeddedDocuments('Level', [{ _id: l.id, 'background.src': null }]); }`,
        sceneUuid,
      );
      const [levelUuid, previous] = await evalGm<[string, string | null]>(
        levelBackground,
        sceneUuid,
      );
      expect(previous).not.toBe(image);
      const done = await set(gmUser, 'scene_background', sceneUuid);
      expect(done.isError, done.text).toBe(false);
      const [, now] = await evalGm<[string, string | null]>(levelBackground, sceneUuid);
      expect(now).toBe(image);
      const pageId = await evalGm<string | null>(
        `async (levelUuid) => {
          const find = () => [...(game.journal.get(game.settings.get('agent-gateway', 'auditJournalId'))?.pages ?? [])]
            .filter((p) => p.system.tool === 'image_assign' &&
              (p.system.targets ?? []).some((t) => t.uuid === levelUuid && t.undoable === true))
            .sort((a, b) => b.system.timestamp - a.system.timestamp)[0];
          let page = find();
          for (let i = 0; i < 40 && !page; i++) { await new Promise((r) => setTimeout(r, 250)); page = find(); }
          return page?.id ?? null;
        }`,
        levelUuid,
      );
      expect(pageId, 'an undoable audit target for the Level').not.toBeNull();
      // The Audit app's own Undo action (the same code path as its Undo button).
      await evalGm(
        `async (id) => {
          const App = game.settings.menus.get('agent-gateway.audit').type;
          await App.onUndo.call({}, null, { dataset: { pageId: id } });
        }`,
        pageId,
      );
      const [, after] = await evalGm<[string, string | null]>(levelBackground, sceneUuid);
      expect(after).toBe(previous);
    },
    humanTimeout(2),
  );

  it(
    'a player sets the portrait and token art of an Actor they own',
    async (ctx) => {
      needGrant(ctx);
      for (const target of ['actor_portrait', 'actor_token']) {
        const r = await set(playerUser, target, ownedUuid);
        expect(r.isError, r.text).toBe(false);
      }
      const read = await evalGm<[string, string]>(
        `async (u) => { const a = await fromUuid(u); return [a.img, a.prototypeToken.texture.src]; }`,
        ownedUuid,
      );
      expect(read).toEqual([image, image]);
    },
    swapTimeout(2),
  );

  it(
    'a player is refused on another user Actor for ownership, not for FILES_BROWSE',
    async (ctx) => {
      needGrant(ctx);
      const other = await set(playerUser, 'actor_portrait', foreignUuid);
      expect(other.isError).toBe(true);
      expect(other.text).toContain('FORBIDDEN');
      expect(other.text).toMatch(/own/i);
      expect(other.text).not.toContain('FILES_BROWSE');
    },
    swapTimeout(1),
  );

  it(
    'a player is refused on GM-only targets',
    async (ctx) => {
      needGrant(ctx);
      const tile = await set(playerUser, 'tile', tileUuid);
      expect(tile.isError).toBe(true);
      expect(tile.text).toContain('FORBIDDEN');
      expect(tile.text).toMatch(/GM/);
      expect(tile.text).not.toContain('FILES_BROWSE');
    },
    swapTimeout(1),
  );

  it(
    'a player without FILES_BROWSE is refused with FORBIDDEN naming FILES_BROWSE',
    async () => {
      await writePermissions({
        ...permissionSnapshot!,
        FILES_BROWSE: browseRoles().filter((r) => r !== 1),
      });
      try {
        expect(await playerCanBrowse(false)).toBe(true);
        const r = await set(playerUser, 'actor_portrait', ownedUuid);
        expect(r.isError).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(r.text).toContain('FILES_BROWSE');
      } finally {
        await grantBrowse();
      }
    },
    swapTimeout(1),
  );

  it('the permission setting round-trips: restoring the snapshot reads back equal', async () => {
    await writePermissions(permissionSnapshot!);
    const now = await evalGm<Record<string, number[]>>(
      `async () => JSON.parse(JSON.stringify(${PERMISSIONS}))`,
      null,
    );
    expect(now).toEqual(permissionSnapshot);
    await grantBrowse();
  });
});
