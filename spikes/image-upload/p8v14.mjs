// player1: try updating image fields; report visibility of the temp documents.
export default async (page, ctx) => page.evaluate(async (c) => {
  const NEW = 'agent-gateway/uploads/ag-spike-52/ag-spike-52-m.png';
  const ids = c.created; const out = { role: game.user.role };
  const tryit = async (label, fn) => { try { const r = await fn(); out[label] = 'ok ' + JSON.stringify(r).slice(0, 100); } catch (e) { out[label] = 'threw ' + String(e).slice(0, 160); } };
  const a = game.actors.get(ids.actor);
  out.vis = {
    actorOwned: !!a, actorHiddenVisible: !!game.actors.get(ids.actorHidden), actorLimitedVisible: !!game.actors.get(ids.actorLimited),
    actorLimitedLevel: game.actors.get(ids.actorLimited)?.ownership && game.actors.get(ids.actorLimited).getUserLevel(game.user),
    sceneVisibleInCollection: !!game.scenes.get(ids.scene), sceneNavInCollection: !!game.scenes.get(ids.sceneNav),
    sceneNavVisibleFlag: game.scenes.get(ids.sceneNav)?.visible, scenePrivVisibleFlag: game.scenes.get(ids.scene)?.visible,
    actorImgReadable: a?.img,
  };
  await tryit('actorImg', async () => (await a.update({ img: NEW })).img);
  await tryit('protoTexture', async () => (await a.update({ 'prototypeToken.texture.src': NEW })).prototypeToken.texture.src);
  const sc = game.scenes.get(ids.scene);
  out.vis.sceneTokenIds = sc ? sc.tokens.map((t) => t.name) : null;
  if (sc) {
    const t = sc.tokens.get(ids.token);
    await tryit('tokenTexture', async () => (await t.update({ 'texture.src': NEW })).texture.src);
    out.vis.tokenHiddenSeen = !!sc.tokens.get(ids.tokenHidden);
    const tile = sc.tiles.get(ids.tile);
    await tryit('tileTexture', async () => (await tile.update({ 'texture.src': NEW })).texture.src);
    await tryit('sceneBackground', async () => (await sc.update({ 'background.src': NEW })).background.src);
  }
  if (sc) await tryit('sceneLevelBackground', async () => (await sc.updateEmbeddedDocuments('Level', [{ _id: 'defaultLevel0000', 'background.src': NEW }])).map((x) => x.background.src));
  const sn = game.scenes.get(ids.sceneNav); out.v14levels = sc ? JSON.stringify(sc.toObject().levels)?.slice(0,200) : null;
  if (sn) await tryit('sceneNavBackground', async () => (await sn.update({ 'background.src': NEW })).background.src);
  // owner update of a not-owned actor
  const lim = game.actors.get(ids.actorLimited);
  if (lim) await tryit('limitedActorImg', async () => (await lim.update({ img: NEW })).img);
  return out;
}, ctx.arg);
