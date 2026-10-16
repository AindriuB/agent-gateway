// GM: create temporary documents. Returns ids.
export default async (page) => page.evaluate(async () => {
  const PNG = 'agent-gateway/uploads/ag-spike-52/ag-spike-52-a.png';
  const p1 = game.users.find((u) => u.name === 'player1');
  const out = { player1: p1.id, created: {} };
  const actor = await Actor.create({ name: 'ag-spike-52-actor', type: 'npc', img: PNG, ownership: { default: 0, [p1.id]: 3 } });
  out.created.actor = actor.id; out.actorImg = actor.img; out.protoTex = actor.prototypeToken.texture.src;
  const actor2 = await Actor.create({ name: 'ag-spike-52-actor-hidden', type: 'npc', img: PNG, ownership: { default: 0 } });
  out.created.actorHidden = actor2.id;
  const actor3 = await Actor.create({ name: 'ag-spike-52-actor-limited', type: 'npc', img: PNG, ownership: { default: 1 } });
  out.created.actorLimited = actor3.id;
  const scene = await Scene.create({ name: 'ag-spike-52-scene', width: 1000, height: 1000, navigation: false, background: { src: PNG } });
  out.created.scene = scene.id;
  const [t1, t2] = await scene.createEmbeddedDocuments('Token', [
    { name: 'ag-spike-52-tok', actorId: actor.id, x: 0, y: 0, texture: { src: PNG } },
    { name: 'ag-spike-52-tok-hidden', actorId: actor2.id, x: 200, y: 0, hidden: true, texture: { src: PNG } },
  ]);
  out.created.token = t1.id; out.created.tokenHidden = t2.id;
  const [tile] = await scene.createEmbeddedDocuments('Tile', [{ x: 0, y: 200, width: 100, height: 100, texture: { src: PNG } }]);
  out.created.tile = tile.id;
  const scene2 = await Scene.create({ name: 'ag-spike-52-scene-nav', width: 1000, height: 1000, navigation: true, background: { src: PNG } });
  out.created.sceneNav = scene2.id;
  const so = scene.toObject(); out.sceneKeys = Object.keys(so).filter(k=>/background|level|texture|foreground/i.test(k)); out.sceneBg = JSON.stringify(so.background)?.slice(0,200); out.levels = JSON.stringify(so.levels)?.slice(0,300); out.tileKeys = Object.keys(tile.toObject()).filter(k=>/level|texture/i.test(k)); out.fields = { actor: 'img', proto: 'prototypeToken.texture.src', token: 'texture.src', scene: 'background.src', tile: 'texture.src', sceneHas: scene.background.src, tileHas: tile.texture.src };
  return out;
});
