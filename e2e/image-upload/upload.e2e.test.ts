import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CallResult } from '../lib/gateway.js';
import { loadContext } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Opt-in: set AGENT_GATEWAY_E2E_UPLOAD=1. Run once against v14 and once against v13 (--foundry).
// Needs the Player role to hold FILES_UPLOAD in the test world (it does not by default). The suite
// creates temporary Actors and a Scene as the GM and deletes exactly those UUIDs in afterAll.
// Uploaded files cannot be deleted through the API; each run leaves a few tiny files under
// agent-gateway/uploads/<userId>/. Every write needs the human's approval.
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
    try {
      if (created.length) {
        const del = await settle(
          gm,
          await gm.gateway.call('document_delete', { uuids: [...created] }),
        );
        if (del.isError) throw new Error(del.text);
      }
    } catch (e) {
      failure = new Error(
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
      const r = await settle(
        gm,
        await gm.gateway.call('image_upload', {
          data: PNG_B64,
          mime: 'image/png',
          sceneUuid,
          setBackground: true,
        }),
      );
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
    async () => {
      const r = await settle(
        player,
        await player.gateway.call('image_upload', {
          data: PNG_B64,
          mime: 'image/png',
          actorUuid: ownedActor,
          setPortrait: true,
          setToken: true,
        }),
      );
      expect(r.isError, `${r.text} (the Player role needs FILES_UPLOAD in the test world)`).toBe(
        false,
      );
      expect(r.structured?.updated).toEqual([ownedActor]);
      const got = await gm.gateway.call('document_get', { uuid: ownedActor });
      expect(JSON.stringify(got.structured ?? got.text)).toContain(String(r.structured?.path));
    },
    humanTimeout(2),
  );

  it(
    "a player is refused on another user's Actor",
    async () => {
      const r = await settle(
        player,
        await player.gateway.call('image_upload', {
          data: PNG_B64,
          mime: 'image/png',
          actorUuid: foreignActor,
          setPortrait: true,
        }),
      );
      expect(r.isError).toBe(true);
      expect(
        r.text,
        'refused for lack of FILES_UPLOAD, which does not prove the ownership check',
      ).not.toContain('FILES_UPLOAD');
      expect(r.text).toMatch(/FORBIDDEN|owned|permission/i);
    },
    humanTimeout(1),
  );
});
