/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained browser callback. Only the exact returned private fixture may be removed. */
export async function task30NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const source = (d: any, auditRoot = false) => {
    const v = d.toObject();
    if (auditRoot) {
      delete v.pages;
      delete v._stats;
    }
    const text = JSON.stringify(v);
    if (text.length > 1048576) throw Error('Bounded native source required');
    return text;
  };
  const authority = () => {
    if (
      !game?.ready ||
      game.world.id !== 'test-world' ||
      Number(game.release.generation) !== input.generation ||
      !game.user?.isGM ||
      game.users.get(game.user.id) !== game.user ||
      game.users.activeGM !== game.user ||
      game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
      (input.baseline &&
        (game.user.id !== input.baseline.gm.id || game.time.worldTime !== input.baseline.worldTime))
    )
      throw Error('Exact sole canonical native GM/time required');
  };
  const queue = () => {
    const raw = localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`);
    const rows = raw === null ? [] : (JSON.parse(raw)[game.user.id] ?? []);
    if (!Array.isArray(rows) || rows.length > 1000) throw Error('Bounded approval queue required');
    const unsettled = rows.filter(
      (r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result),
    );
    if (unsettled.some((r: any) => !(input.ids ?? []).includes(r.id)))
      throw Error('Unrelated unsettled approval');
    return { rows, unsettled };
  };
  const audit = () => {
    const selected = game.settings.get('agent-gateway', 'auditJournalId'),
      storage = game.settings.storage.get('world'),
      anchors = storage.contents.filter((s: any) => s.key === 'agent-gateway.auditJournalId'),
      anchor = anchors[0],
      d = game.journal.get(selected);
    if (
      anchors.length !== 1 ||
      storage.get(anchor.id) !== anchor ||
      anchor.value !== selected ||
      anchor.user !== null ||
      !game.users.get(anchor._stats?.lastModifiedBy)?.isGM ||
      d?.flags?.['agent-gateway']?.auditJournal !== true ||
      d.ownership.default !== 0 ||
      game.users.some((u: any) => !u.isGM && d.getUserLevel(u) !== 0) ||
      !game.documentTypes.JournalEntryPage.includes('agent-gateway.audit') ||
      !game.modules.get('agent-gateway')?.documentTypes?.JournalEntryPage?.audit
    )
      throw Error('Trusted private declared audit subtype required');
    const pin = g.__task30Audit?.get(input.run);
    if (
      input.baseline &&
      (!pin ||
        pin.audit !== d ||
        pin.anchor !== anchor ||
        pin.anchorSource !== source(anchor) ||
        selected !== input.baseline.auditId)
    )
      throw Error('Canonical audit anchor changed');
    return { d, anchor, selected };
  };
  const collections = [
    'actors',
    'items',
    'journal',
    'scenes',
    'combats',
    'tables',
    'playlists',
    'macros',
    'messages',
  ];
  const roots = () =>
    Object.fromEntries(
      collections.map((k) => {
        if (game[k].contents.length > 1000) throw Error('Bounded native roots required');
        return [k, game[k].contents.map((d: any) => d.uuid).sort()];
      }),
    );
  const views = () => ({
    scene: g.canvas.scene?.id ?? null,
    level: g.canvas.level?.id ?? null,
    targets: [...game.user.targets].map((t: any) => t.id).sort(),
    combat: g.ui.combat?.viewed?.uuid ?? null,
    active: game.scenes.contents
      .filter((s: any) => s.active)
      .map((s: any) => s.id)
      .sort(),
  });
  const settings = () => {
    const rows = game.settings.storage.get('world').contents;
    if (rows.length > 1000) throw Error('Bounded settings required');
    return rows
      .map((d: any) => ({ id: d.id, source: source(d) }))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
  };
  const unchanged = () => {
    authority();
    queue();
    const a = audit();
    if (
      JSON.stringify(settings()) !== JSON.stringify(input.baseline.settings) ||
      JSON.stringify(views()) !== JSON.stringify(input.baseline.views)
    )
      throw Error('Settings/views changed');
    const current = roots();
    if (input.uuid) current.actors = current.actors.filter((u: string) => u !== input.uuid);
    if (JSON.stringify(current) !== JSON.stringify(input.baseline.roots))
      throw Error('Original roots changed');
    for (const s of input.baseline.sources) {
      const d = game[s.collection].get(s.id);
      if (!d || source(d, s.collection === 'journal' && s.id === a.selected) !== s.source)
        throw Error('Original document source changed');
    }
    for (const p of input.baseline.auditPages) {
      const d = a.d.pages.get(p.id);
      if (!d || source(d) !== p.source) throw Error('Original audit entry changed');
    }
    return a.d;
  };
  const fixture = () => {
    const pin = g.__task30Fixtures?.get(input.run),
      d = pin?.actor;
    if (
      !pin?.validated ||
      !d ||
      !(d instanceof g.CONFIG.Actor.documentClass) ||
      d.documentName !== 'Actor' ||
      game.actors.get(d.id) !== d ||
      d.parent ||
      d.pack ||
      d.uuid !== input.uuid ||
      input.baseline.roots.actors.includes(d.uuid) ||
      d.flags?.world?.task30 !== input.run ||
      d.type !== 'npc' ||
      ![input.plan.actor.name, input.plan.names[0]].includes(d.name)
    )
      throw Error('Exact canonical fixture custody required');
    const expected = JSON.parse(pin.source),
      actual = d.toObject();
    expected.name = d.name;
    delete actual._stats;
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error('Fixture changed beyond approved name');
    return d;
  };
  // Read-only recovery remains available if authority changed after the create await.
  if (input.op === 'createdCandidate') {
    const pin = g.__task30Fixtures?.get(input.run);
    return pin ? { uuid: pin.uuid, validated: pin.validated === true } : null;
  }
  authority();
  if (input.op === 'baseline') {
    queue();
    const a = audit();
    if (
      !Number.isFinite(game.time.worldTime) ||
      game.modules.contents.some((m: any) => m.active && m.id !== 'agent-gateway') ||
      !game.modules.get('agent-gateway')?.active
    )
      throw Error('Isolated native module required');
    (g.__task30Audit ??= new Map()).set(input.run, {
      audit: a.d,
      anchor: a.anchor,
      anchorSource: source(a.anchor),
    });
    const policyRaw = game.settings.get('agent-gateway', 'worldPolicy');
    const policy = typeof policyRaw === 'string' ? JSON.parse(policyRaw) : policyRaw;
    const matrix = policy.version === 1 ? policy.world : policy;
    if (!['allow', 'ask_owner', 'ask_gm'].includes(matrix?.gmAgents?.write))
      throw Error('GM writes disabled: no live policy change authorized');
    return {
      gm: { id: game.user.id, name: game.user.name },
      worldTime: game.time.worldTime,
      version: game.version,
      moduleVersion: game.modules.get('agent-gateway').version,
      policy,
      views: views(),
      settings: settings(),
      roots: roots(),
      auditId: a.selected,
      auditPages: a.d.pages.contents.map((d: any) => ({ id: d.id, source: source(d) })),
      sources: collections.flatMap((k) =>
        game[k].contents.map((d: any) => ({
          collection: k,
          id: d.id,
          source: source(d, k === 'journal' && d.id === a.selected),
        })),
      ),
    };
  }
  const a = unchanged();
  if (input.op === 'create') {
    if (g.__task30Fixtures?.has(input.run)) throw Error('Fixture nonce reused');
    const d = await g.CONFIG.Actor.documentClass.create(input.plan.actor, { renderSheet: false });
    // Retain the exact returned identity before any awaited-create postcondition can fail.
    const candidate = {
      actor: d,
      uuid: typeof d?.uuid === 'string' ? d.uuid : null,
      validated: false,
      source: '',
    };
    (g.__task30Fixtures ??= new Map()).set(input.run, candidate);
    authority();
    if (
      !d ||
      game.actors.get(d.id) !== d ||
      d.parent ||
      d.pack ||
      input.baseline.roots.actors.includes(d.uuid) ||
      d.flags?.world?.task30 !== input.run ||
      d.name !== input.plan.actor.name ||
      d.type !== 'npc' ||
      d.items.size ||
      d.effects.size ||
      d.ownership.default !== 0 ||
      game.users.some((u: any) => !u.isGM && d.testUserPermission(u, 'OBSERVER'))
    )
      throw Error('Private fixture create postcondition failed');
    const v = d.toObject();
    delete v._stats;
    candidate.source = JSON.stringify(v);
    candidate.validated = true;
    return { uuid: d.uuid, source: d.toObject() };
  }
  if (input.op === 'queue') return queue().rows;
  if (input.op === 'audits')
    return a.pages.contents
      .filter((p: any) => !input.baseline.auditPages.some((b: any) => b.id === p.id))
      .map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
  if (input.op === 'facts') {
    const d = fixture();
    return { uuid: d.uuid, name: d.name, modifiedTime: d._stats.modifiedTime };
  }
  if (input.op === 'cleanup') {
    if (queue().unsettled.length)
      throw Error('Pending replay requires reconciliation before cleanup');
    const d = fixture();
    await d.delete({ render: false });
    authority();
    if (game.actors.get(d.id)) throw Error('Exact fixture deletion failed');
    unchanged();
    g.__task30Fixtures.delete(input.run);
    return { absent: d.uuid, originalSourcesUnchanged: true, settingsViewsTimeUnchanged: true };
  }
  throw Error('Unsupported native operation');
}

/** Replace only the reviewed template cache; never approval manager state or controls. */
export async function task30PreloadTemplate(text: string): Promise<boolean> {
  const g = globalThis as any,
    path = 'modules/agent-gateway/templates/approval/approval.hbs';
  if (typeof text !== 'string' || text.length > 65536 || !text.includes('data-request'))
    throw Error('Exact approval template required');
  const compiled = g.Handlebars.compile(text);
  g.Handlebars.partials[path] = compiled;
  if (g.foundry?.applications?.handlebars?.loadTemplates)
    await g.foundry.applications.handlebars.loadTemplates([path]);
  g.Handlebars.partials[path] = compiled;
  return true;
}
