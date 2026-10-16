export default async (page) => page.evaluate(() => {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const src = (f) => f.toString();
  const up = src(FP.upload);
  return {
    sameClass: FP === FilePicker.implementation, globalDeprecated: FilePicker === foundry.applications.apps.FilePicker,
    uploadTail: up.slice(1700),
    browseSrc: src(FP.browse).slice(0, 1800),
    uploadURL: FP.uploadURL, browseURL: FP.browseURL,
    createDirSrc: src(FP.createDirectory).slice(0, 900),
    uploadLen: FP.upload.length, 
    defaults: Object.fromEntries(['FILES_BROWSE','FILES_UPLOAD'].map(k => [k, CONST.USER_PERMISSIONS?.[k] ?? null])),
    defPerm: foundry.CONST.USER_PERMISSIONS && Object.fromEntries(Object.entries(foundry.CONST.USER_PERMISSIONS).filter(([k])=>k.startsWith('FILES')).map(([k,v])=>[k,v])),
    roles: CONST.USER_ROLES,
    worldPerms: { b: game.settings.get('core','permissions').FILES_BROWSE, u: game.settings.get('core','permissions').FILES_UPLOAD },
    corePermsDefault: CONST.USER_PERMISSIONS ? undefined: undefined,
  };
});
