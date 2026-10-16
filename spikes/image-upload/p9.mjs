export default async (page, ctx) => page.evaluate(async (c) => {
  const ids = c.created; const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const sc = game.scenes.get(ids.scene), sn = game.scenes.get(ids.sceneNav);
  return {
    levels: L,
    hiddenActor: { level: game.actors.get(ids.actorHidden)?.getUserLevel(game.user), ownershipRaw: game.actors.get(ids.actorHidden)?.ownership, testLimited: game.actors.get(ids.actorHidden)?.testUserPermission(game.user, 'LIMITED') },
    limitedActor: { level: game.actors.get(ids.actorLimited)?.getUserLevel(game.user), testObserver: game.actors.get(ids.actorLimited)?.testUserPermission(game.user, 'OBSERVER') },
    ownedActor: game.actors.get(ids.actor)?.getUserLevel(game.user),
    scene: { name: sc?.name, visible: sc?.visible, active: sc?.active, nav: sc?.navigation, level: sc?.getUserLevel(game.user), testLimited: sc?.testUserPermission(game.user, 'LIMITED') },
    sceneNav: { visible: sn?.visible, nav: sn?.navigation, level: sn?.getUserLevel(game.user) },
    tokens: sc?.tokens.map((t) => ({ n: t.name, hidden: t.hidden, isOwner: t.isOwner, actorLevel: t.actor?.getUserLevel(game.user), actorPresent: !!t.actor })),
    displayed: game.scenes.viewed?.name ?? null,
    sceneVisibleDef: Scene.prototype.hasOwnProperty('visible') || String(Object.getOwnPropertyDescriptor(Scene.prototype, 'visible')?.get).slice(0, 300),
  };
}, ctx.arg);
