export default async (page) => page.evaluate(async () => {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const out = { role: game.user.role, canUpload: game.user.can('FILES_UPLOAD'), canBrowse: game.user.can('FILES_BROWSE'), uploadable: CONST.UPLOADABLE_FILE_EXTENSIONS ? Object.keys(CONST.UPLOADABLE_FILE_EXTENSIONS) : null, imgExt: Object.keys(CONST.IMAGE_FILE_EXTENSIONS ?? {}) };
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const notes = [];
  const orig = ui.notifications.error.bind(ui.notifications);
  ui.notifications.error = (m, ...a) => { notes.push(String(m).slice(0, 150)); return orig(m, ...a); };
  const T = 'agent-gateway/uploads/ag-spike-52';
  try { const r = await FP.upload('data', T, new File([png], 'ag-spike-52-p1.png', { type: 'image/png' }), {}, { notify: false }); out.upload = r === false ? 'false' : JSON.stringify(r)?.slice(0, 200); } catch (e) { out.upload = 'threw ' + String(e).slice(0, 200); }
  for (const [k, src, t] of [['browseT', 'data', T], ['browseRoot', 'data', ''], ['browsePublic', 'public', '']]) {
    try { const r = await FP.browse(src, t); out[k] = { dirs: r.dirs?.length, files: r.files?.length }; } catch (e) { out[k] = 'threw ' + String(e).slice(0, 200); }
  }
  try { out.mkdir = JSON.stringify(await FP.createDirectory('data', 'agent-gateway/uploads/ag-spike-52-pdir', { notify: false })).slice(0, 150); } catch (e) { out.mkdir = 'threw ' + String(e).slice(0, 150); }
  out.notes = notes;
  return out;
});
