import { tokenManage } from '@agent-gateway/protocol';
import { withPreparation } from '../ops/context.js';
import { defineWriteHandler } from './_write.js';
import { actionFields, check, resolve, footprint, notInCombat, version, gm } from './_scene.js';
export const tokenManageHandler = withPreparation(
  defineWriteHandler({
    targets: () => [],
    async run(ctx) {
      const args = tokenManage.input.parse(ctx.args);
      let uuid: string;
      if (args.action === 'place') {
        actionFields(args, ['sceneUuid', 'actorUuid', 'x', 'y'], ['hidden', 'rotation']);
        const scene = await resolve(ctx, args.sceneUuid!, 'Scene');
        const actor = await resolve(ctx, args.actorUuid!, 'Actor');
        check(ctx, scene, 'Scene');
        const actorVersion = version(actor);
        const validate = () => {
          check(ctx, scene, 'Scene');
          check(ctx, actor, 'Actor');
          if (version(actor) !== actorVersion)
            throw new Error('Actor changed during token preparation');
        };
        validate();
        const token = await actor.getTokenDocument(
          {
            x: args.x,
            y: args.y,
            ...(args.hidden !== undefined ? { hidden: args.hidden } : {}),
            ...(args.rotation !== undefined ? { rotation: args.rotation } : {}),
          },
          { parent: scene },
        );
        validate();
        if (token?.documentName !== 'Token' || token.parent !== scene)
          throw new Error('Native token preparation returned the wrong parent');
        footprint(scene, token, args.x!, args.y!);
        const data = token.toObject();
        delete data._id;
        await ctx.intendCreate(scene.uuid);
        validate();
        footprint(scene, token, args.x!, args.y!);
        const made = await scene.createEmbeddedDocuments('Token', [data], ctx.callOptions);
        validate();
        if (!Array.isArray(made) || made.length !== 1)
          throw new Error('Native token creation did not return one token');
        check(ctx, made[0], 'Token');
        uuid = made[0].uuid;
        await ctx.created(uuid, scene.uuid);
        check(ctx, scene, 'Scene');
        check(ctx, made[0], 'Token');
        footprint(scene, made[0], args.x!, args.y!);
        if (
          (args.hidden !== undefined && made[0].hidden !== args.hidden) ||
          (args.rotation !== undefined && made[0].rotation !== args.rotation % 360)
        )
          throw new Error('Native token hook changed requested visibility or rotation');
        if (
          made[0].parent !== scene ||
          made[0].actorId !== actor.id ||
          made[0].x !== args.x ||
          made[0].y !== args.y
        )
          throw new Error('Native token creation did not preserve the requested placement');
      } else {
        actionFields(args, ['tokenUuid']);
        const token = await resolve(ctx, args.tokenUuid!, 'Token');
        const parent = token.parent;
        const before = version(token);
        const validate = () => {
          check(ctx, token, 'Token');
          if (token.parent !== parent) throw new Error('Token parent changed before mutation');
          if (version(token) !== before) throw new Error('Token changed before mutation');
          if (args.action === 'remove') notInCombat(token);
        };
        validate();
        await ctx.snapshot(token.uuid);
        validate();
        uuid = token.uuid;
        if (args.action === 'remove') {
          const result = await token.delete(ctx.callOptions);
          gm(ctx);
          check(ctx, parent, 'Scene');
          if (token.parent !== parent) throw new Error('Token parent changed during deletion');
          if (result !== token || token.parent.tokens.get(token.id))
            throw new Error('Native token deletion did not persist');
        } else {
          const hidden = args.action === 'hide';
          const result = await token.update({ hidden }, ctx.callOptions);
          check(ctx, token, 'Token');
          if (token.parent !== parent)
            throw new Error('Token parent changed during visibility update');
          if (result !== token || token.hidden !== hidden)
            throw new Error('Native token visibility update did not persist');
        }
      }
      return {
        text: 'Token action completed',
        structured: { action: args.action, uuid, completed: true },
      };
    },
  }),
);
