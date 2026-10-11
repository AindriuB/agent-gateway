/* eslint-disable @typescript-eslint/no-explicit-any */
import { sceneControl } from '@agent-gateway/protocol';
import { hasSceneLevels, viewSceneCompat } from '../compat/index.js';
import { defineWriteHandler, invalid } from './_write.js';
import { actionFields, check, resolve, collection, version } from './_scene.js';
declare const game: any;
export const sceneControlHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = sceneControl.input.parse(ctx.args);
    actionFields(args, [
      'sceneUuid',
      ...(args.action === 'set_darkness'
        ? ['darkness']
        : args.action === 'set_level'
          ? ['levelId']
          : []),
    ]);
    if (args.action === 'set_level' && !hasSceneLevels())
      invalid('requires Foundry v14 Scene Levels');
    const scene = await resolve(ctx, args.sceneUuid, 'Scene');
    const before = version(scene);
    const validate = () => {
      check(ctx, scene, 'Scene');
      if (version(scene) !== before) throw new Error('Scene changed before action');
    };
    if (args.action === 'activate') {
      const active = collection(game.scenes).filter((s) => s.active);
      const stamps = active.map((s) => version(s));
      for (const s of new Set([scene, ...active])) {
        check(ctx, s, 'Scene');
        await ctx.snapshot(s.uuid);
        validate();
      }
      if (
        active.some((s, i) => !s.active || version(s) !== stamps[i]) ||
        collection(game.scenes).some((s) => s.active && !active.includes(s))
      )
        throw new Error('Active scenes changed before activation');
      validate();
      const result = await scene.update({ active: true }, ctx.callOptions);
      check(ctx, scene, 'Scene');
      if (
        result !== scene ||
        !scene.active ||
        collection(game.scenes).some((s) => s !== scene && s.active)
      )
        throw new Error('Global scene activation did not persist');
    } else if (args.action === 'set_darkness') {
      const unlocked = () => {
        validate();
        if (scene.environment?.darknessLock !== false)
          invalid('Scene darkness is locked or unavailable');
      };
      unlocked();
      await ctx.snapshot(scene.uuid);
      unlocked();
      const result = await scene.update(
        { 'environment.darknessLevel': args.darkness },
        ctx.callOptions,
      );
      check(ctx, scene, 'Scene');
      if (result !== scene || scene.environment.darknessLevel !== args.darkness)
        throw new Error('Darkness update did not persist');
    } else {
      const level = args.action === 'set_level' ? scene.levels?.get(args.levelId) : undefined;
      if (args.action === 'set_level' && (!level || level.parent !== scene))
        invalid('A canonical scene level is required');
      validate();
      await viewSceneCompat(scene, level);
      check(ctx, scene, 'Scene');
      if (level && scene.levels.get(level.id) !== level)
        throw new Error('Scene level changed during view');
    }
    return {
      text:
        args.action === 'activate'
          ? 'Scene activated globally; connected views may change'
          : 'Scene action completed',
      structured: { action: args.action, uuid: scene.uuid, completed: true },
    };
  },
});
