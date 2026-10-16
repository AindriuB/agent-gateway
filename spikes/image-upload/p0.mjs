export default async (page) => page.evaluate(() => ({
  version: game.version, system: game.system.id, role: game.user.role, name: game.user.name,
  routePrefix: game.data.options?.routePrefix ?? null, basePath: location.pathname,
  pickerV13ns: typeof foundry.applications?.apps?.FilePicker, nsImpl: typeof foundry.applications?.apps?.FilePicker?.implementation,
  globalFP: typeof globalThis.FilePicker, CONFIG_FP: typeof CONFIG.ux?.FilePicker,
  uploadSrc: (foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker).upload.toString().slice(0, 1800),
  perms: CONFIG.ux ? null : null,
  permsSetting: game.settings.get('core','permissions'),
  roleNames: CONST.USER_ROLES,
}));
