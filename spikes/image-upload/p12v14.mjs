export default async (page, ctx) => page.evaluate(async (c) => {
  const PNG = 'agent-gateway/uploads/ag-spike-52/ag-spike-52-a.png'; const out = {};
  const sc = game.scenes.get(c.created.scene);
  const t = async (l, f) => { try { out[l] = 'ok ' + JSON.stringify(await f()).slice(0, 200); } catch (e) { out[l] = 'threw ' + String(e).slice(0, 200); } };
  out.levelCollection = typeof sc.levels?.get; out.levelIds = sc.levels?.map?.((l) => l.id);
  await t('updateEmbedded', async () => { const r = await sc.updateEmbeddedDocuments('Level', [{ _id: 'defaultLevel0000', 'background.src': PNG }]); return r.map((x) => x.background.src); });
  out.afterBg = sc.levels.get('defaultLevel0000')?.background?.src;
  out.sceneBgAlias = sc.background?.src;
  await t('updateTopLevelBackground', async () => (await sc.update({ 'background.src': PNG })).background.src);
  const doc = sc.toObject(); out.topBackgroundKeys = Object.keys(doc.background ?? {});
  return out;
}, ctx.arg);
