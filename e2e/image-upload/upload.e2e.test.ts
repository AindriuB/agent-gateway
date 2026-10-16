import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_UPLOAD=1. Run once against v14 and once against v13 (--foundry).
// The Player role lacks FILES_UPLOAD and FILES_BROWSE by default, so the suite snapshots the world's
// `core.permissions` setting as the GM, grants both to the PLAYER role for the run, and restores the
// exact snapshot in afterAll (asserting the read-back equals it). If the grant never takes effect
// (e.g. v14 requiredRoles), the player cases skip with a reason naming the Foundry version.
// The suite creates temporary Actors and a Scene as the GM and deletes exactly those UUIDs in
// afterAll. Uploaded files cannot be deleted through the API: every uploaded path is printed at the
// end for the operator to delete from agent-gateway/uploads/<userId>/. Every write needs approval.
const enabled = process.env.AGENT_GATEWAY_E2E_UPLOAD === '1';

const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;
const UUID_RE = /\b(?:Actor|Scene)\.[A-Za-z0-9]{16}\b/;

// A valid 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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
        text: String(current.structured.result),
      };
    if (status === 'denied' || status === 'expired' || status === 'unknown')
      throw new Error(`approval ${id} ended ${String(status)}: ${current.text}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
}

describe('image_upload (set AGENT_GATEWAY_E2E_UPLOAD=1)', () => {
  let gm: UserSession;
  let player: UserSession;
  const created: string[] = [];
  let sceneUuid: string;
  let ownedActor: string;
  let foreignActor: string;
  let snapshot: Record<string, number[]> | undefined;
  let grantSkipReason: string | undefined;
  const uploaded: string[] = [];

  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    gm.browser.page.evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>;
  const writePermissions = (value: Record<string, number[]>): Promise<void> =>
    evalGm<void>(`async (v) => { await game.settings.set('core', 'permissions', v); }`, value);
  const roles = (name: string): number[] =>
    snapshot?.[name] ?? (name === 'FILES_UPLOAD' ? [3, 4] : [2, 3, 4]);
  /** Waits (about 10 s) for the player's own client to report both permissions as wanted. */
  const playerHas = (upload: boolean, browse: boolean): Promise<boolean> =>
    player.browser.page.evaluate(
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
  const upload = async (who: UserSession, extra: Record<string, unknown>): Promise<CallResult> => {
    const r = await settle(
      who,
      await who.gateway.call('image_upload', { data: PNG_B64, mime: 'image/png', ...extra }),
    );
    if (!r.isError && typeof r.structured?.path === 'string') uploaded.push(r.structured.path);
    return r;
  };

  const create = async (type: string, data: Record<string, unknown>): Promise<string> => {
    const r = await settle(
      gm,
      await gm.gateway.call('document_create', { type, data: JSON.stringify(data) }),
    );
    expect(r.isError, r.text).toBe(false);
    const uuid =
      (typeof r.structured?.uuid === 'string' ? r.structured.uuid : undefined) ??
      UUID_RE.exec(r.text)?.[0];
    expect(typeof uuid).toBe('string');
    created.push(uuid!);
    return uuid!;
  };

  beforeAll(async () => {
    if (!enabled) return;
    const ctx = loadContext();
    gm = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    player = await openUserSession(ctx.config, ctx.paths, ctx.config.playerUser);
    snapshot = await evalGm<Record<string, number[]>>(
      `async () => JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')))`,
      null,
    );
    expect(snapshot, 'core.permissions setting').toBeTypeOf('object');
    if (!(await setGrant(true, true))) {
      const reason = `Foundry ${gm.foundryVersion} did not grant FILES_UPLOAD and FILES_BROWSE to the Player role (role 1)`;
      // v13 has no requiredRoles limit, so a failed grant there means a wrong core.permissions key.
      if (String(gm.foundryVersion).startsWith('13')) throw new Error(reason);
      grantSkipReason = reason;
    }
    sceneUuid = await create('Scene', { name: 'agent-gateway e2e upload scene (temporary)' });
    // Ownership default 3 (OWNER) makes the Actor the player's; default 0 (NONE) is not theirs.
    ownedActor = await create('Actor', {
      name: 'agent-gateway e2e upload owned (temporary)',
      type: 'character',
      ownership: { default: 3 },
    });
    foreignActor = await create('Actor', {
      name: 'agent-gateway e2e upload foreign (temporary)',
      type: 'character',
      ownership: { default: 0 },
    });
  }, humanTimeout(3));

  afterAll(async () => {
    let failure: unknown;
    if (gm && snapshot) {
      try {
        await writePermissions(snapshot);
        const back = await evalGm<unknown>(
          `async () => JSON.parse(JSON.stringify(game.settings.get('core', 'permissions')))`,
          null,
        );
        expect(back, 'permissions restored to the snapshot').toEqual(snapshot);
      } catch (e) {
        failure = new Error(
          `RESIDUE: file permissions were not restored: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    if (uploaded.length)
      console.log(`UPLOADED FILES (delete by hand from the Data folder):\n${uploaded.join('\n')}`);
    try {
      if (created.length) {
        const del = await settle(
          gm,
          await gm.gateway.call('document_delete', { uuids: [...created] }),
        );
        if (del.isError) throw new Error(del.text);
      }
    } catch (e) {
      failure ??= new Error(
        `RESIDUE: temporary documents ${created.join(', ')} may still exist: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    for (const s of [gm, player]) {
      try {
        await s?.close();
      } catch (e) {
        failure ??= e;
      }
    }
    if (failure) throw failure;
  }, humanTimeout(1));

  beforeEach((ctx) => {
    if (!enabled) ctx.skip();
  });

  it(
    'a GM uploads a PNG and sets a temporary scene background',
    async () => {
      const r = await upload(gm, { sceneUuid, setBackground: true });
      expect(r.isError, r.text).toBe(false);
      expect(String(r.structured?.path)).toMatch(/^agent-gateway\/uploads\/[A-Za-z0-9]+\/.+\.png$/);
      expect(r.structured?.updated).toEqual([sceneUuid]);
      expect(r.text).toContain('does not delete the uploaded file');
      const got = await gm.gateway.call('document_get', { uuid: sceneUuid });
      expect(JSON.stringify(got.structured ?? got.text)).toContain(String(r.structured?.path));
    },
    humanTimeout(2),
  );

  it(
    'a player sets the portrait and token of an Actor they own',
    async (ctx) => {
      needGrant(ctx);
      const r = await upload(player, { actorUuid: ownedActor, setPortrait: true, setToken: true });
      expect(r.isError, r.text).toBe(false);
      expect(r.structured?.updated).toEqual([ownedActor]);
      const got = await gm.gateway.call('document_get', { uuid: ownedActor });
      expect(JSON.stringify(got.structured ?? got.text)).toContain(String(r.structured?.path));
    },
    humanTimeout(2),
  );

  it(
    "a player is refused on another user's Actor by the ownership rule",
    async (ctx) => {
      needGrant(ctx);
      const r = await upload(player, { actorUuid: foreignActor, setPortrait: true });
      expect(r.isError, r.text).toBe(true);
      expect(r.text).toContain('FORBIDDEN');
      expect(r.text).not.toMatch(/FILES_/);
    },
    humanTimeout(1),
  );

  it(
    'a player without FILES_UPLOAD is refused, naming FILES_UPLOAD',
    async (ctx) => {
      needGrant(ctx);
      try {
        expect(await setGrant(false, true), 'FILES_UPLOAD removal took effect').toBe(true);
        const r = await upload(player, { actorUuid: ownedActor, setPortrait: true });
        expect(r.isError, r.text).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(r.text).toContain('FILES_UPLOAD');
      } finally {
        await setGrant(true, true);
      }
    },
    humanTimeout(1),
  );

  it(
    'a player with FILES_UPLOAD but without FILES_BROWSE is refused, naming FILES_BROWSE',
    async (ctx) => {
      needGrant(ctx);
      try {
        expect(await setGrant(true, false), 'FILES_BROWSE removal took effect').toBe(true);
        const r = await upload(player, { actorUuid: ownedActor, setPortrait: true });
        expect(r.isError, r.text).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(r.text).toContain('FILES_BROWSE');
      } finally {
        await setGrant(true, true);
      }
    },
    humanTimeout(1),
  );
});
