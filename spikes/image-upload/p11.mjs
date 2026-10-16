export default async (page, ctx) => page.evaluate(async (c) => {
  const ids = c.created; const out = {};
  for (const [coll, key] of [[game.scenes, 'scene'], [game.scenes, 'sceneNav'], [game.actors, 'actor'], [game.actors, 'actorHidden'], [game.actors, 'actorLimited']]) {
    const d = coll.get(ids[key]);
    if (d && d.name.startsWith('ag-spike-52-')) { await d.delete(); out[key] = 'deleted ' + ids[key]; } else out[key] = 'not found or name mismatch';
  }
  out.remaining = [...game.scenes, ...game.actors].filter((d) => d.name.startsWith('ag-spike-52-')).map((d) => d.id);
  out.tokensTilesGone = !game.scenes.get(ids.scene);
  return out;
}, ctx.arg);
