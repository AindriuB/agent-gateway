/* eslint-disable @typescript-eslint/no-explicit-any */
import { tokenMove } from '@agent-gateway/protocol';
import { fromUuidCompat, moveTokenCompat } from '../compat/index.js';
import { defineWriteHandler, forbid, invalid, owns, trustedUser } from './_write.js';
import type { OpContext } from '../ops/types.js';
declare const canvas: any;
declare const game: any;

/** Only canonical documents in the actual rendered scene can be moved or targeted. */
export function checkSceneToken(ctx: OpContext, token: any, requireOwner: boolean): any {
  const user = trustedUser(ctx);
  const scene = canvas?.scene;
  if (
    canvas?.ready !== true ||
    !scene ||
    game.scenes?.get(scene.id) !== scene ||
    token?.documentName !== 'Token' ||
    token.pack ||
    token.parent !== scene ||
    scene.tokens?.get(token.id) !== token ||
    token.uuid !== `Scene.${scene.id}.Token.${token.id}` ||
    token.object?.document !== token ||
    canvas.tokens?.get(token.id) !== token.object ||
    (requireOwner && !owns(token, user)) ||
    (!user.isGM &&
      (token.hidden === true || token.object.visible !== true || token.object.renderable !== true))
  )
    forbid('An accessible canonical token on the rendered scene is required');
  return scene;
}
function points(args: ReturnType<typeof tokenMove.input.parse>, scene: any, token: any) {
  if (
    args.path
      ? args.x !== undefined || args.y !== undefined
      : args.x === undefined || args.y === undefined
  )
    invalid('Supply either x and y or a nonempty path');
  const size = scene.grid?.size;
  if (
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(scene.width) ||
    !Number.isFinite(scene.height)
  )
    forbid('Scene grid dimensions are unavailable');
  const rect = scene.dimensions?.sceneRect;
  if (
    !rect ||
    ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
    rect.width <= 0 ||
    rect.height <= 0
  )
    forbid('Scene rectangle is unavailable');
  const footprint = token.getSize?.();
  const width = footprint?.width;
  const height = footprint?.height;
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
    forbid('Token footprint is unavailable');
  const result = (args.path ?? [{ x: args.x!, y: args.y! }]).map(({ x, y }) => ({
    x: x * size,
    y: y * size,
  }));
  for (const p of result)
    if (
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < rect.x ||
      p.y < rect.y ||
      p.x + width > rect.x + rect.width ||
      p.y + height > rect.y + rect.height
    )
      invalid('Every waypoint and token footprint must fit within the scene');
  return { result, size };
}
export const tokenMoveHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = tokenMove.input.parse(ctx.args);
    let token = await fromUuidCompat(args.tokenUuid);
    checkSceneToken(ctx, token, true);
    const uuid = token.uuid;
    points(args, token.parent, token);
    await ctx.snapshot(uuid);
    token = await fromUuidCompat(uuid);
    const scene = checkSceneToken(ctx, token, true);
    const { result, size } = points(args, scene, token);
    const completed = await moveTokenCompat(token, result, ctx.callOptions);
    if (!Number.isFinite(token.x) || !Number.isFinite(token.y))
      throw new Error('Native movement returned invalid coordinates');
    return {
      text: completed ? 'Token movement completed' : 'Token movement blocked or stopped',
      structured: { tokenUuid: uuid, completed, x: token.x / size, y: token.y / size },
    };
  },
});
