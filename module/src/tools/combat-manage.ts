/* eslint-disable @typescript-eslint/no-explicit-any */
import { combatManage } from '@agent-gateway/protocol';
import {
  manageCombatProgressCompat,
  prepareCoreInitiativeCompat,
  supportsCoreInitiativeCompat,
} from '../compat/index.js';
import { withPreparation } from '../ops/context.js';
import { defineWriteHandler, invalid } from './_write.js';
import { actionFields, check, resolve, collection, version, canonical, gm } from './_scene.js';
declare const game: any;
export const combatManageHandler = withPreparation(
  defineWriteHandler({
    targets: () => [],
    async run(ctx) {
      const args = combatManage.input.parse(ctx.args);
      const list =
        args.action === 'add_combatants'
          ? 'tokenUuids'
          : args.action === 'remove_combatants' || args.action === 'roll_initiative'
            ? 'combatantUuids'
            : undefined;
      actionFields(args, ['combatUuid', ...(list ? [list] : [])]);
      const ids = list ? args[list]! : [];
      if (new Set(ids).size !== ids.length) invalid('Duplicate selected documents');
      const combat = await resolve(ctx, args.combatUuid, 'Combat');
      const scene = combat.scene ?? null;
      if (scene) check(ctx, scene, 'Scene');
      const before = version(combat),
        round = combat.round,
        turn = combat.turn;
      const validate = () => {
        check(ctx, combat, 'Combat');
        if ((combat.scene ?? null) !== scene) throw new Error('Encounter scene changed');
        if (scene) check(ctx, scene, 'Scene');
        if (version(combat) !== before || combat.round !== round || combat.turn !== turn)
          throw new Error('Encounter changed before mutation');
      };
      const selected: any[] = [];
      for (const uuid of ids) {
        const doc = await resolve(ctx, uuid, list === 'tokenUuids' ? 'Token' : 'Combatant');
        validate();
        if (list === 'tokenUuids' ? doc.parent !== scene : doc.parent !== combat)
          invalid('Selected documents belong to another encounter scene');
        selected.push(doc);
      }
      const stamps = selected.map(version);
      const actors = selected.map((d) => d.actor);
      const actorStamps = actors.map((a) => (a ? version(a) : undefined));
      const fresh = () => {
        validate();
        selected.forEach((d, i) => {
          check(ctx, d, list === 'tokenUuids' ? 'Token' : 'Combatant');
          if (
            version(d) !== stamps[i] ||
            d.actor !== actors[i] ||
            (actors[i] && version(actors[i]) !== actorStamps[i])
          )
            throw new Error('Selected document changed');
          if (args.action === 'roll_initiative' && actors[i]) {
            const actor = actors[i];
            if (!canonical(actor)) {
              const token = d.token;
              check(ctx, token, 'Token');
              const base = game.actors.get(token.actorId);
              check(ctx, base, 'Actor');
              if (
                token.actor !== actor ||
                d.actor !== actor ||
                actor.parent !== token ||
                d.tokenId !== token.id ||
                d.sceneId !== token.parent.id
              )
                throw new Error('Synthetic initiative actor is not canonical');
            } else check(ctx, actor, 'Actor');
          }
        });
      };
      let affected: string[] = [],
        worldTimeDelta = 0;
      if (args.action === 'add_combatants') {
        if (!combat.scene) invalid('Encounter must be bound to a scene');
        if (selected.some((t) => collection(combat.combatants).some((c) => c.tokenId === t.id)))
          invalid('Selected token already participates');
        await ctx.intendCreate(combat.uuid);
        fresh();
        const made = await combat.createEmbeddedDocuments(
          'Combatant',
          selected.map((t) => ({
            tokenId: t.id,
            sceneId: t.parent.id,
            actorId: t.actorId,
            hidden: t.hidden,
          })),
          ctx.callOptions,
        );
        check(ctx, combat, 'Combat');
        if (!Array.isArray(made))
          throw new Error('Native combatant creation returned no documents');
        for (const doc of made) {
          check(ctx, doc, 'Combatant');
          if (doc.parent !== combat || !selected.some((t) => t.id === doc.tokenId))
            throw new Error('Unexpected native combatant');
          await ctx.created(doc.uuid, combat.uuid);
          check(ctx, combat, 'Combat');
          check(ctx, doc, 'Combatant');
          affected.push(doc.uuid);
        }
        if (
          made.length !== selected.length ||
          new Set(made.map((d) => d.tokenId)).size !== selected.length
        )
          throw new Error('Native system created only part of the selected combatants');
      } else if (args.action === 'remove_combatants') {
        for (const doc of selected) {
          await ctx.snapshot(doc.uuid);
          fresh();
        }
        fresh();
        const result = await combat.deleteEmbeddedDocuments(
          'Combatant',
          selected.map((d) => d.id),
          ctx.callOptions,
        );
        check(ctx, combat, 'Combat');
        if (
          !Array.isArray(result) ||
          result.length !== selected.length ||
          new Set(result).size !== selected.length ||
          result.some((d: any) => !selected.includes(d)) ||
          selected.some((d) => combat.combatants.get(d.id))
        )
          throw new Error('Native combatant deletion was partial');
        affected = selected.map((d) => d.uuid);
      } else if (args.action === 'roll_initiative') {
        if (game.system?.id === 'pf2e')
          invalid(
            'PF2e initiative automation is unsupported: native preparation can execute uncorrelated rule effects',
          );
        if (selected.some((d) => !supportsCoreInitiativeCompat(d)))
          invalid('Initiative automation is unsupported for this system adapter');
        const updates: any[] = [];
        for (const doc of selected) {
          fresh();
          const roll = await prepareCoreInitiativeCompat(doc);
          fresh();
          updates.push({ _id: doc.id, initiative: roll.total });
        }
        for (const doc of selected) {
          await ctx.snapshot(doc.uuid);
          fresh();
        }
        fresh();
        const result = await combat.updateEmbeddedDocuments('Combatant', updates, {
          ...ctx.callOptions,
          turnEvents: false,
        });
        check(ctx, combat, 'Combat');
        if (
          !Array.isArray(result) ||
          result.length !== selected.length ||
          new Set(result).size !== selected.length ||
          result.some((d: any) => !selected.includes(d)) ||
          updates.some((u) => combat.combatants.get(u._id)?.initiative !== u.initiative)
        )
          throw new Error('Native initiative update was partial');
        for (const doc of selected) check(ctx, doc, 'Combatant');
        affected = selected.map((d) => d.uuid);
      } else {
        await ctx.snapshot(combat.uuid);
        fresh();
        if (args.action === 'end') {
          const result = await combat.delete(ctx.callOptions);
          gm(ctx);
          if (scene) check(ctx, scene, 'Scene');
          if (result !== combat || game.combats.get(combat.id))
            throw new Error('Native encounter deletion did not persist');
        } else
          worldTimeDelta = await manageCombatProgressCompat(
            combat,
            args.action,
            ctx.callOptions,
            fresh,
            () => {
              check(ctx, combat, 'Combat');
              if ((combat.scene ?? null) !== scene)
                throw new Error('Encounter scene changed during progression');
              if (scene) check(ctx, scene, 'Scene');
            },
          );
      }
      return {
        text:
          args.action === 'end'
            ? 'Encounter deleted; native viewed-combat activation and effect refresh may occur'
            : `Encounter action completed; world-time delta ${worldTimeDelta}`,
        structured: {
          action: args.action,
          uuid: combat.uuid,
          completed: true,
          affected,
          worldTimeDelta,
        },
      };
    },
  }),
);
