import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadContext, requireUuids } from '../lib/context.js';
import { openUserSession, type UserSession } from '../lib/session.js';

// Needs the repository owner's per-run approval and a world with images:
// AGENT_GATEWAY_E2E_IMAGE=1 plus the fixtures below. A test whose variable is unset is skipped, and
// its name says which variable it needs:
//   AGENT_GATEWAY_E2E_IMAGE_FILE        a Data-relative PNG/JPEG/WebP path
//   AGENT_GATEWAY_E2E_IMAGE_OWNED_ACTOR an Actor UUID the player owns
//   AGENT_GATEWAY_E2E_IMAGE_NO_PERM_ACTOR an Actor UUID the player has no permission on
//   AGENT_GATEWAY_E2E_IMAGE_HIDDEN_TOKEN a hidden token UUID the player does NOT own
const enabled = process.env.AGENT_GATEWAY_E2E_IMAGE === '1';
const env = (name: string): string | undefined => process.env[`AGENT_GATEWAY_E2E_IMAGE_${name}`];

const blocks = (raw: unknown): Array<{ type: string }> =>
  ((raw as { content?: Array<{ type: string }> }).content ?? []) as Array<{ type: string }>;

describe.skipIf(!enabled)('image_view', () => {
  const ctx = loadContext();
  let gm: UserSession;
  let player: UserSession;
  beforeAll(async () => {
    gm = await openUserSession(ctx.config, ctx.paths, ctx.config.gmUser);
    player = await openUserSession(ctx.config, ctx.paths, ctx.config.playerUser);
  });
  afterAll(async () => {
    await gm?.close();
    await player?.close();
  });

  it('a GM views the active scene background as one image block', async () => {
    const r = await gm.gateway.call('image_view', {
      source: 'scene_background',
      uuid: requireUuids(ctx).activeScene,
    });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    expect(r.structured).toBeUndefined();
  });

  it.skipIf(!env('FILE'))('a GM views a data file (needs _FILE)', async () => {
    const path = env('FILE');
    expect(path, 'set AGENT_GATEWAY_E2E_IMAGE_FILE').toBeTruthy();
    const r = await gm.gateway.call('image_view', { source: 'file', path });
    expect(r.isError, r.text).toBe(false);
    expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
  });

  it.skipIf(!env('OWNED_ACTOR'))(
    'a player views an owned Actor portrait (needs _OWNED_ACTOR)',
    async () => {
      const uuid = env('OWNED_ACTOR');
      expect(uuid, 'set AGENT_GATEWAY_E2E_IMAGE_OWNED_ACTOR').toBeTruthy();
      const r = await player.gateway.call('image_view', { source: 'actor_portrait', uuid });
      expect(r.isError, r.text).toBe(false);
      expect(blocks(r.raw).filter((b) => b.type === 'image')).toHaveLength(1);
    },
  );

  it.skipIf(!env('HIDDEN_TOKEN') || !env('NO_PERM_ACTOR'))(
    'a player is refused a hidden token they do not own and an Actor with no permission (needs _HIDDEN_TOKEN and _NO_PERM_ACTOR)',
    async () => {
      for (const [source, uuid] of [
        ['token', env('HIDDEN_TOKEN')],
        ['actor_portrait', env('NO_PERM_ACTOR')],
      ] as const) {
        expect(uuid, `set the ${source} fixture`).toBeTruthy();
        const r = await player.gateway.call('image_view', { source, uuid });
        expect(r.isError).toBe(true);
        expect(r.text).toContain('FORBIDDEN');
        expect(blocks(r.raw).some((b) => b.type === 'image')).toBe(false);
      }
    },
  );
});
