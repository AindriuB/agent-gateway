export default async (page) => page.evaluate(async () => {
  const out = { origin: location.origin === new URL(location.href).origin, routePrefix: game.data.options?.routePrefix ?? null };
  const path = 'agent-gateway/uploads/ag-spike-52/ag-spike-52-a.png';
  out.url = foundry.utils.getRoute ? foundry.utils.getRoute(path) : null;
  const r = await fetch('/' + path);
  out.status = r.status; out.hdr = Object.fromEntries([...r.headers].filter(([k]) => ['content-type','content-length','cache-control','access-control-allow-origin','content-security-policy','x-content-type-options','content-disposition','etag','accept-ranges'].includes(k)));
  const s = await fetch('/' + 'agent-gateway/uploads/ag-spike-52/ag-spike-52-s.svg'); out.svgType = s.headers.get('content-type'); out.svgCSP = s.headers.get('content-security-policy');
  // big file for stream cut: a core public image
  const big = await (async () => { const b = await foundry.applications.apps.FilePicker.implementation.browse('public', 'ui').catch(()=>null); return b?.files?.filter(f=>/\.(webp|png|jpg)$/.test(f)).slice(0, 6); })();
  out.bigCandidates = big;
  if (big?.length) {
    const u = '/' + big[0];
    const rr = await fetch(u); const total = rr.headers.get('content-length');
    const rd = rr.body.getReader(); let n = 0; let cancelled = false;
    while (true) { const { done, value } = await rd.read(); if (done) break; n += value.length; if (n > 1000) { await rd.cancel(); cancelled = true; break; } }
    out.stream = { u: big[0], total, readBeforeCancel: n, cancelled };
    const blob = await (await fetch(u)).blob();
    try { const bm = await createImageBitmap(blob); const oc = new OffscreenCanvas(Math.min(bm.width, 256), Math.min(bm.height, 256)); oc.getContext('2d').drawImage(bm, 0, 0, oc.width, oc.height); const j = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.8 }); const w = await oc.convertToBlob({ type: 'image/webp', quality: 0.8 }); out.downscale = { w: bm.width, h: bm.height, jpegType: j.type, jpegSize: j.size, webpType: w.type, webpSize: w.size, srcSize: blob.size }; } catch (e) { out.downscale = 'threw ' + String(e).slice(0,150); }
  }
  return out;
});
