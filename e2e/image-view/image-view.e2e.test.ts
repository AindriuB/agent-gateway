import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseImageUploadText } from '@agent-gateway/protocol/tools';
import type { CallResult, GatewayProcess } from '../lib/gateway.js';
import { loadContext, requireUuids } from '../lib/context.js';
import { RECONNECT_MS, Rig } from '../multi/rig.js';

// Needs the repository owner's per-run approval: AGENT_GATEWAY_E2E_IMAGE=1. One Rig keeps the GM and
// player browsers open; the gateway is bound to one user at a time and swapped once, from the GM to
// the player. beforeAll uploads a 1x1 PNG as the GM (one approval) and creates, natively in the GM
// page, an Actor the player owns, an Actor with no permission, and a Scene holding a hidden Token
// of the second Actor. afterAll deletes each by its exact UUID. The uploaded file cannot be deleted
// through the API: its path is printed for the operator to delete by hand.
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';

const APPROVAL_TTL_MS = 60 * 60_000;
const humanTimeout = (approvals: number): number => approvals * APPROVAL_TTL_MS + 5 * 60_000;

// A valid 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const blocks = (raw: unknown): Array<{ type: string }> =>
  ((raw as { content?: Array<{ type: string }> }).content ?? []) as Array<{ type: string }>;

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

describe.skipIf(!enabled)('image_view', () => {
  const ctx = loadContext();
  const gmUser = ctx.config.gmUser;
  const playerUser = ctx.config.playerUser;
  let rig: Rig | undefined;
  let bound: string | undefined;
  let probePath: string;
  let ownedActor: string;
  let noPermActor: string;
  let hiddenToken: string;
  const created: string[] = [];
  const uploaded: string[] = [];

  const evalGm = <T>(fn: string, arg: unknown): Promise<T> =>
    rig!.users.get(gmUser)!.browser.page.evaluate(`(${fn})(${JSON.stringify(arg)})`) as Promise<T>;
  /** The gateway bound to `user`; swaps only when the binding differs. */
  const as = async (user: string): Promise<GatewayProcess> => {
    if (bound !== user) {
      bound = undefined; // a swap that fails partway leaves the binding unknown
      await rig!.swap(user);
      bound = user;
    }
    return rig!.gateway!;
  };
  /** Creates a document natively in the GM page and records its UUID for afterAll. */
  const createDoc = async (expr: string, arg: unknown): Promise<string> => {
    const uuid = await evalGm<string>(expr, arg);
    expect(typeof uuid).toBe('string');
    created.push(uuid);
    return uuid;
  };

  beforeAll(async () => {
    rig = new Rig(ctx);
    await rig.open(gmUser, [gmUser, playerUser]);
    bound = gmUser;
    const gw = await as(gmUser);
    const up = await settle(
      gw,
      await gw.call('image_upload', { data: PNG_B64, mime: 'image/png' }),
    );
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
    ownedActor = await actor('agent-gateway e2e view owned (temporary)', 3);
    noPermActor = await actor('agent-gateway e2e view no-permission (temporary)', 0);
    const sceneUuid = await createDoc(
      `async () => (await Scene.create({ name: 'agent-gateway e2e view scene (temporary)' })).uuid`,
      null,
    );
    hiddenToken = await createDoc(
      `async ([sceneUuid, actorUuid, src]) => {
        const scene = await fromUuid(sceneUuid);
        const actor = await fromUuid(actorUuid);
        const [t] = await scene.createEmbeddedDocuments('Token', [
          { name: actor.name, actorId: actor.id, x: 0, y: 0, hidden: true, texture: { src } },
        ]);
        return t.uuid;
      }`,
      [sceneUuid, noPermActor, probePath],
    );
  }, 15 * 60_000);

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
