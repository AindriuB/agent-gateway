import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseImageUploadText } from '@agent-gateway/protocol/tools';
import { foundryVersion } from '../lib/browser.js';
import type { CallResult, GatewayProcess } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { RECONNECT_MS, Rig } from '../multi/rig.js';

// Opt-in: set AGENT_GATEWAY_E2E_UPLOAD=1. Run once against v14 and once against v13 (--foundry).
// The Player role lacks FILES_UPLOAD and FILES_BROWSE by default, so the suite snapshots the world's
// `core.permissions` setting as the GM, grants both to the PLAYER role for the run, and restores the
// exact snapshot in afterAll (asserting the read-back equals it). If the grant never takes effect
// (e.g. v14 requiredRoles), the player cases skip with a reason naming the Foundry version.
// One Rig holds the GM and player browsers open for the whole suite; the gateway is bound to one
// user at a time and swapped only when a test needs the other. The suite creates temporary Actors
// and a Scene natively in the GM page and deletes exactly those UUIDs there in afterAll.
// Uploaded files cannot be deleted through the API: every uploaded path is printed at the
// end for the operator to delete from agent-gateway/uploads/<userId>/. Every write needs approval.
const enabled = process.env.AGENT_GATEWAY_E2E_UPLOAD === '1';

const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;
/** A test that may swap the gateway once on top of its approvals. */
const swapTimeout = (approvals: number): number => humanTimeout(approvals) + RECONNECT_MS;

// A valid 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
        text: String(current.structured.result),
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

describe('image_upload (set AGENT_GATEWAY_E2E_UPLOAD=1)', () => {
  let rig: Rig | undefined;
  let gmUser = '';
  let playerUser = '';
  let bound: string | undefined;
  const created: string[] = [];
  let sceneUuid: string;
  let ownedActor: string;
  let foreignActor: string;
  let snapshot: Record<string, number[]> | undefined;
  let grantSkipReason: string | undefined;
  const uploaded: string[] = [];

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
  const writePermissions = (value: Record<string, number[]>): Promise<void> =>
    evalGm<void>(`async (v) => { await game.settings.set('core', 'permissions', v); }`, value);
  const roles = (name: string): number[] =>
    snapshot?.[name] ?? (name === 'FILES_UPLOAD' ? [3, 4] : [2, 3, 4]);
  /** Waits (about 10 s) for the player's own client to report both permissions as wanted. */
  const playerHas = (upload: boolean, browse: boolean): Promise<boolean> =>
    pageOf(playerUser).evaluate(
      `(async ([u, b]) => {
        const ok = () => game.user.can('FILES_UPLOAD') === u && game.user.can('FILES_BROWSE') === b;
        for (let i = 0; i < 40 && !ok(); i++) await new Promise((r) => setTimeout(r, 250));
        return ok();
      })(${JSON.stringify([upload, browse])})`,
    ) as Promise<boolean>;
  /** Sets the PLAYER role's grant for each permission, based on the snapshot. */
  const setGrant = async (upload: boolean, browse: boolean): Promise<boolean> => {
    const withRole = (name: string, on: boolean): number[] => {
      const rest = roles(name).filter((r) => r !== 1);
      return on ? [...rest, 1] : rest;
    };
    await writePermissions({
      ...snapshot!,
      FILES_UPLOAD: withRole('FILES_UPLOAD', upload),
      FILES_BROWSE: withRole('FILES_BROWSE', browse),
    });
    return playerHas(upload, browse);
  };
  const needGrant = (ctx: { skip: (reason?: string) => never }): void => {
    if (grantSkipReason) ctx.skip(grantSkipReason);
  };
  const upload = async (user: string, extra: Record<string, unknown>): Promise<CallResult> => {
    const gw = await as(user);
    let r = await settle(
      gw,
      await gw.call('image_upload', { data: PNG_B64, mime: 'image/png', ...extra }),
    );
    // After a long approval wait only the result text survives: recover the details from it.
    const parsed = parseImageUploadText(r.text);
    if (!r.isError && parsed) {
      r = { ...r, structured: { ...parsed, ...r.structured } };
      uploaded.push(parsed.path);
    }
    return r;
  };

  /** Creates a document natively in the GM page and records its UUID for afterAll. */
  const create = async (cls: string, data: Record<string, unknown>): Promise<string> => {
    const uuid = await evalGm<string>(`async (d) => (await ${cls}.create(d)).uuid`, data);
    expect(typeof uuid).toBe('string');
    created.push(uuid);
    return uuid;
  };

  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    gmUser = ctx.config.gmUser;
    playerUser = ctx.config.playerUser;
    rig = new Rig(ctx);
    await rig.open(gmUser, [gmUser, playerUser]);
    bound = gmUser;
    snapshot = await evalGm<Record<string, number[]>>(
      `async () => JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')))`,
      null,
    );
    expect(snapshot, 'core.permissions setting').toBeTypeOf('object');
    if (!(await setGrant(true, true))) {
      const version = await foundryVersion(pageOf(gmUser));
      const reason = `Foundry ${version} did not grant FILES_UPLOAD and FILES_BROWSE to the Player role (role 1)`;
      // v13 has no requiredRoles limit, so a failed grant there means a wrong core.permissions key.
      if (version.startsWith('13')) throw new Error(reason);
      grantSkipReason = reason;
    }
    sceneUuid = await create('Scene', { name: 'agent-gateway e2e upload scene (temporary)' });
    // As in the real world: explicit per-user OWNER for the player. pf2e forces default
    // ownership to LIMITED on a character, so the player's real level is checked below.
    ownedActor = await evalGm<string>(
      `async (d) => { const u = game.users.getName(d.player); if (!u) throw new Error('no player user ' + d.player); return (await Actor.create({ name: d.name, type: 'character', ownership: { default: 0, [u.id]: 3 } })).uuid; }`,
      { name: 'agent-gateway e2e upload owned (temporary)', player: playerUser },
    );
    created.push(ownedActor);

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
        })(${JSON.stringify(ownedActor)})`,
      ),
      'player client sees the owned Actor as OWNER',
    ).toBe(true);
    // An npc keeps the ownership it is given; a character is forced to default LIMITED by pf2e.
    foreignActor = await create('Actor', {
      name: 'agent-gateway e2e upload foreign (temporary)',
      type: 'npc',
      ownership: { default: 0 },
    });
    const levels = (await pageOf(playerUser).evaluate(
      `(${PLAYER_LEVELS})(${JSON.stringify([ownedActor, foreignActor])})`,
    )) as Levels;
    for (const u of [ownedActor, foreignActor]) {
      expect(levels[u], `fixture ${u} did not reach the player's client`).not.toBeNull();
    }
    expect(levels[ownedActor]?.owner, 'fixture is not OWNER for the player (owned Actor)').toBe(
      true,
    );
    expect(
      levels[foreignActor]?.limited,
      'fixture is not NONE for the player (no-permission Actor): it grants LIMITED or more',
    ).toBe(false);
  }, 15 * 60_000);

  afterAll(async () => {
    const failures: string[] = [];
    const gmOpen = rig?.users.has(gmUser) === true;
    if (gmOpen && snapshot) {
      try {
        await writePermissions(snapshot);
        const back = await evalGm<unknown>(
          `async () => JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')))`,
          null,
        );
        expect(back, 'permissions restored to the snapshot').toEqual(snapshot);
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
    if (uploaded.length)
      console.log(`UPLOADED FILES (delete by hand from the Data folder):\n${uploaded.join('\n')}`);
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

  // GM test first, then the player tests, so the gateway swaps once.
  it(
    'a GM uploads a PNG and sets a temporary scene background',
    async () => {
      const r = await upload(gmUser, { sceneUuid, setBackground: true });
      expect(r.isError, r.text).toBe(false);
      expect(String(r.structured?.path)).toMatch(/^agent-gateway\/uploads\/[A-Za-z0-9]+\/.+\.png$/);
      expect(r.structured?.updated).toEqual([sceneUuid]);
      expect(r.text).toContain('does not delete the uploaded file');
      const got = await evalGm<string>(
        `async (u) => JSON.stringify((await fromUuid(u)).toObject())`,
        sceneUuid,
      );
      expect(got).toContain(String(r.structured?.path));
    },
    swapTimeout(2),
  );

  it(
    'a player sets the portrait and token of an Actor they own',
    async (ctx) => {
      needGrant(ctx);
      const r = await upload(playerUser, {
        actorUuid: ownedActor,
        setPortrait: true,
        setToken: true,
      });
      expect(r.isError, r.text).toBe(false);
      expect(r.structured?.updated).toEqual([ownedActor]);
      const got = await evalGm<string>(
        `async (u) => JSON.stringify((await fromUuid(u)).toObject())`,
        ownedActor,
      );
      expect(got).toContain(String(r.structured?.path));
    },
    swapTimeout(2),
  );

  it(
    "a player is refused on another user's Actor by the ownership rule",
    async (ctx) => {
      needGrant(ctx);
      const r = await upload(playerUser, { actorUuid: foreignActor, setPortrait: true });
      expect(r.isError, r.text).toBe(true);
      expect(r.text).toContain('FORBIDDEN');
      expect(r.text).toMatch(/own/i);
      expect(r.text).not.toMatch(/FILES_/);
    },
    swapTimeout(1),
  );

  it(
    'a player without FILES_UPLOAD is refused, naming FILES_UPLOAD',
    async (ctx) => {
      needGrant(ctx);
      try {
        expect(await setGrant(false, true), 'FILES_UPLOAD removal took effect').toBe(true);
        const r = await upload(playerUser, { actorUuid: ownedActor, setPortrait: true });
        expect(r.isError, r.text).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(r.text).toContain('FILES_UPLOAD');
      } finally {
        await setGrant(true, true);
      }
    },
    swapTimeout(1),
  );

  it(
    'a player with FILES_UPLOAD but without FILES_BROWSE is refused, naming FILES_BROWSE',
    async (ctx) => {
      needGrant(ctx);
      try {
        expect(await setGrant(true, false), 'FILES_BROWSE removal took effect').toBe(true);
        const r = await upload(playerUser, { actorUuid: ownedActor, setPortrait: true });
        expect(r.isError, r.text).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(r.text).toContain('FILES_BROWSE');
      } finally {
        await setGrant(true, true);
      }
    },
    swapTimeout(1),
  );
});
