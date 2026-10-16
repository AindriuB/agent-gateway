export default async (page) => page.evaluate(async () => {
  const FP = foundry.applications.apps.FilePicker.implementation;
  const out = { created: [] };
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
  const dirs = ['agent-gateway', 'agent-gateway/uploads', 'agent-gateway/uploads/ag-spike-52'];
  out.dirs = [];
  for (const d of dirs) { try { const r = await FP.createDirectory('data', d, { notify: false }); out.dirs.push([d, JSON.stringify(r)?.slice(0,150)]); } catch (e) { out.dirs.push([d, 'threw ' + String(e).slice(0, 150)]); } }
  try { out.dirAgain = JSON.stringify(await FP.createDirectory('data', 'agent-gateway/uploads/ag-spike-52', { notify: false })); } catch (e) { out.dirAgain = 'threw ' + String(e).slice(0, 150); }
  const T = 'agent-gateway/uploads/ag-spike-52';
  const up = async (label, name, bytes, type, target = T) => {
    try {
      const r = await FP.upload('data', target, new File([bytes], name, { type }), {}, { notify: false });
      out[label] = r === undefined ? 'undefined' : r === false ? 'false' : JSON.stringify(r).slice(0, 220);
      if (r?.path) out.created.push(r.path);
    } catch (e) { out[label] = 'threw ' + String(e).slice(0, 200); }
  };
  await up('png', 'ag-spike-52-a.png', png, 'image/png');
  await up('pngAgain', 'ag-spike-52-a.png', png, 'image/png');
  await up('svg', 'ag-spike-52-s.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'), 'image/svg+xml');
  await up('mimeMismatch', 'ag-spike-52-m.png', new TextEncoder().encode('not an image'), 'image/png');
  await up('html', 'ag-spike-52-h.html', new TextEncoder().encode('<b>x</b>'), 'text/html');
  await up('dblext', 'ag-spike-52-d.png.exe', png, 'image/png');
  await up('slashName', '../ag-spike-52-x.png', png, 'image/png');
  // traversal on v14: browse / createDirectory only (no upload)
  try { out.mkdirTraverse = JSON.stringify(await FP.createDirectory('data', 'agent-gateway/uploads/ag-spike-52/../../..', { notify: false })).slice(0,120); } catch (e) { out.mkdirTraverse = 'threw ' + String(e).slice(0, 150); }
  out.listing = await FP.browse('data', T).then(r => ({ files: r.files, dirs: r.dirs })).catch(e => String(e));
  return out;
});
