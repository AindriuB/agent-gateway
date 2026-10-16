import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseImageUploadText } from '@agent-gateway/protocol/tools';
import type { CallResult, GatewayProcess } from '../lib/gateway.js';
import { loadContext, requireUuids } from '../lib/context.js';
import { RECONNECT_MS, Rig } from '../multi/rig.js';

// Needs the repository owner's per-run approval: AGENT_GATEWAY_E2E_IMAGE=1. One Rig keeps the GM
// and player browsers open; the gateway is bound to one user at a time and swapped once, from the
// GM to the player. beforeAll uploads a 1x1 PNG as the GM (one approval) and creates, natively in
// the GM page, an Actor the player owns, an Actor with no permission, an Actor the player can see
// (LIMITED), and a LIMITED Scene holding a hidden Token of the LIMITED Actor. afterAll deletes
// each by its exact UUID. The uploaded file cannot be deleted through the API: its path is printed
// for the operator to delete by hand.
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';

const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;

// A valid 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const blocks = (raw: unknown): Array<{ type: string }> =>
  ((raw as { content?: Array<{ type: string }> }).content ?? []) as Array<{ type: string }>;

const log = (msg: string): void => console.log(`[image-view] ${msg}`);

/** Rejects with an error naming `phase` if `p` has not settled within `ms`; never waits forever. */
async function bounded<T>(phase: string, ms: number, p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[image-view] phase "${phase}" did not finish within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The longest settle() polls: the approval TTL plus a minute, so a lost approval fails by name. */
const SETTLE_MAX_MS = APPROVAL_TTL_MS + 60_000;

/** Settles an approval on the gateway that made the call. */
async function settle(gateway: GatewayProcess, r: CallResult): Promise<CallResult> {
  if (r.structured?.status !== 'pending_approval') return r;
  const id = String(r.structured.id);
  const started = Date.now();
  let last = '';
  let lastBeat = started;
  while (Date.now() - started < SETTLE_MAX_MS) {
    const current = await bounded(
      `approval_status ${id}`,
      90_000,
      gateway.call('approval_status', { id }),
    );
    if (current.isError) throw new Error(`approval_status ${id} failed: ${current.text}`);
    const status = String(current.structured?.status);
    if (status !== last) {
      log(`approval ${id} status ${last || '(first poll)'} -> ${status}`);
      last = status;
    } else if (Date.now() - lastBeat >= 60_000) {
      log(`approval ${id} still ${status} after ${Math.round((Date.now() - started) / 1000)} s`);
    }
    if (Date.now() - lastBeat >= 60_000) lastBeat = Date.now();
    if (status === 'approved' && typeof current.structured?.result === 'string')
      return {
        ...current,
        isError: current.structured?.resultFailed === true,
        text: String(current.structured.result),
      };
    if (status === 'denied' || status === 'expired' || status === 'unknown')
      throw new Error(`approval ${id} ended ${status}: ${current.text}`);
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(
    `[image-view] phase "waiting for approval ${id}" did not finish within ${SETTLE_MAX_MS} ms (last status ${last})`,
  );
}

describe.skipIf(!enabled)('image_view', () => {
  const ctx = loadContext();
  const gmUser = ctx.config.gmUser;
  const playerUser = ctx.config.playerUser;
  let rig: Rig | undefined;
  let bound: string | undefined;
  let probePath: string;
  let ownedActor: string;
  let noPermActor: string;
  let limitedActor: string;
  let hiddenToken: string;
  const created: string[] = [];
  const uploaded: string[] = [];

  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    bounded(
      'GM page evaluate',
      60_000,
      rig!.users
        .get(gmUser)!
        .browser.page.evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>,
    );
  /** The gateway bound to `user`; swaps only when the binding differs. */
  const as = async (user: string): Promise<GatewayProcess> => {
    if (bound !== user) {
      bound = undefined; // a swap that fails partway leaves the binding unknown
      log(`swapping the gateway to ${user}`);
      await bounded(`gateway swap to ${user}`, RECONNECT_MS + 60_000, rig!.swap(user));
      bound = user;
      log(`gateway bound to ${user}`);
    }
    return rig!.gateway!;
  };
  /** Creates a document natively in the GM page and records its UUID for afterAll. */
  const createDoc = async (expr: string, arg: unknown): Promise<string> => {
    const uuid = await evalGm<string>(expr, arg);
    expect(typeof uuid).toBe('string');
    created.push(uuid);
    log(`created ${uuid}`);
    return uuid;
  };

  beforeAll(
    async () => {
      rig = new Rig(ctx);
      log(`rig open: gateway bound to ${gmUser}, joining ${gmUser} and ${playerUser}`);
      await bounded(
        'rig open (gateway, browsers, welcomes)',
        RECONNECT_MS + 150_000,
        rig.open(gmUser, [gmUser, playerUser]),
      );
      log(
        `browsers welcomed: ${[...rig.users].map(([k, u]) => `${k}=${u.frames.welcomes}`).join(', ')}`,
      );
      bound = gmUser;
      const gw = await as(gmUser);
      log(`gateway bound to ${gmUser}`);
      const first = await bounded(
        'image_upload call (no approval wait; the module answers within about 25 s)',
        90_000,
        gw.call('image_upload', { data: PNG_B64, mime: 'image/png' }),
      );
      log(
        `image_upload sent: isError=${String(first.isError)} status=${String(first.structured?.status)} approval id=${String(first.structured?.id)}${first.isError ? ` text=${first.text.slice(0, 200)}` : ''}`,
      );
      if (first.structured?.status === 'pending_approval')
        log(
          `WAITING for the GM to approve image_upload ${String(first.structured.id)} in the GM window`,
        );
      const up = await settle(gw, first);
      log(`image_upload settled: isError=${String(up.isError)}`);
      const parsed = parseImageUploadText(up.text);
      if (!up.isError && parsed) uploaded.push(parsed.path);
      expect(up.isError, up.text).toBe(false);
      expect(parsed, 'the image_upload result names the file').toBeTruthy();
      probePath = parsed!.path;
      const actor = (name: string, ownership: number): Promise<string> =>
        createDoc(`async (d) => (await Actor.create(d)).uuid`, {
          name,
          type: 'character',
          img: probePath,
          ownership: { default: ownership },
        });
      // As in the real world: explicit per-user OWNER for the player, default 0 (NONE).
      ownedActor = await createDoc(
        `async (d) => { const u = game.users.getName(d.player); if (!u) throw new Error('no player user ' + d.player); return (await Actor.create({ name: d.name, type: 'character', img: d.img, ownership: { default: 0, [u.id]: 3 } })).uuid; }`,
        {
          name: 'agent-gateway e2e view owned (temporary)',
          player: playerUser,
          img: probePath,
        },
      );
      // The player's own client must see the Actor as OWNER before any tool call.
      log('OWNER wait: the player client must see the owned Actor');
      const ownerSeen = await bounded(
        'OWNER wait (player client)',
        60_000,
        rig.users.get(playerUser)!.browser.page.evaluate(
          `(async (uuid) => {
            for (let i = 0; i < 40; i++) {
              const a = await fromUuid(uuid);
              if (a && a.testUserPermission(game.user, 'OWNER') === true) return true;
              await new Promise((r) => setTimeout(r, 250));
            }
            return false;
          })(${JSON.stringify(ownedActor)})`,
        ) as Promise<boolean>,
      );
      log(`OWNER wait done: ${String(ownerSeen)}`);
      expect(ownerSeen, 'player client sees the owned Actor as OWNER').toBe(true);
      noPermActor = await actor('agent-gateway e2e view no-permission (temporary)', 0);
      // LIMITED (1) on this Actor and on the Scene below: the player can see both, so only
      // token.hidden can refuse the Token.
      limitedActor = await actor('agent-gateway e2e view limited (temporary)', 1);
      const sceneUuid = await createDoc(`async (d) => (await Scene.create(d)).uuid`, {
        name: 'agent-gateway e2e view scene (temporary)',
        ownership: { default: 1 },
      });
      hiddenToken = await createDoc(
        `async ([sceneUuid, actorUuid, src]) => {
        const scene = await fromUuid(sceneUuid);
        const actor = await fromUuid(actorUuid);
        const [t] = await scene.createEmbeddedDocuments('Token', [
          { name: actor.name, actorId: actor.id, x: 0, y: 0, hidden: true, texture: { src } },
        ]);
        return t.uuid;
      }`,
        [sceneUuid, limitedActor, probePath],
      );
    },
    humanTimeout(1) + RECONNECT_MS,
  );

  afterAll(async () => {
    const failures: string[] = [];
    const gmOpen = rig?.users.has(gmUser) === true;
    if (created.length && !gmOpen)
      failures.push(
        `RESIDUE: temporary documents ${created.join(', ')} may still exist: no GM page`,
      );
    if (gmOpen) {
      // Reverse order, so the embedded Token goes before its Scene.
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

  // GM tests first, then the player tests, so the gateway swaps once.
  it('a GM views the active scene background as one image block', async () => {
    const gw = await as(gmUser);
    const r = await gw.call('image_view', {
      source: 'scene_background',
      uuid: requireUuids(ctx).activeScene,
    });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    expect(r.structured).toBeUndefined();
  });

  it('a GM views a data file', async () => {
    const gw = await as(gmUser);
    const r = await gw.call('image_view', { source: 'file', path: probePath });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it(
    'a player views an owned Actor portrait',
    async () => {
      const gw = await as(playerUser);
      const r = await gw.call('image_view', { source: 'actor_portrait', uuid: ownedActor });
      expect(r.isError, r.text).toBe(false);
      expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    },
    humanTimeout(0) + RECONNECT_MS,
  );

  it('a player is refused a hidden token they do not own and an Actor with no permission', async () => {
    const gw = await as(playerUser);
    for (const [source, uuid] of [
      ['token', hiddenToken],
      ['actor_portrait', noPermActor],
    ] as const) {
      const r = await gw.call('image_view', { source, uuid });
      expect(r.isError).toBe(true);
      expect(r.text).toContain('FORBIDDEN');
      expect(blocks(r.raw).some((b) => b.type === 'image')).toBe(false);
    }
  });
});
