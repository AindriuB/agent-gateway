export default async (page) => page.evaluate(async () => {
  const raw = (data) => new Promise((res) => { const t = setTimeout(() => res('timeout'), 8000); game.socket.emit('manageFiles', data, { notify: false }, (r) => { clearTimeout(t); res(JSON.stringify(r).slice(0, 200)); }); });
  return { rawBrowse: await raw({ action: 'browseFiles', storage: 'data', target: '' }), rawMkdir: await raw({ action: 'createDirectory', storage: 'data', target: 'agent-gateway/uploads/ag-spike-52-nope' }),
    src: String(foundry.applications.apps.FilePicker.implementation.browse).slice(0,100) };
});
