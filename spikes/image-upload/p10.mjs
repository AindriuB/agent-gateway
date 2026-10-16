export default async (page) => page.evaluate(() => {
  const d = (o, k) => { let p = o; while (p) { const g = Object.getOwnPropertyDescriptor(p, k); if (g) return String(g.get ?? g.value).slice(0, 500); p = Object.getPrototypeOf(p); } };
  const nav = foundry.applications.ui.SceneNavigation;
  return { visible: d(Scene.prototype, 'visible'), navScenes: d(nav.prototype, '_prepareContext')?.slice(0,200), navGet: Object.getOwnPropertyNames(nav.prototype).filter(n => /scene/i.test(n)), navScenesSrc: [...Object.getOwnPropertyNames(nav.prototype)].filter(n=>/getVisible|visible/i.test(n)) , sceneCollVis: String(game.scenes.constructor.prototype.hasOwnProperty('_onVisible')) };
});
