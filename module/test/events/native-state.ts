/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained native callback; writes are restricted to the approved nonce-owned fixture tree. */
export async function task27NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    gm() {
      if (
        !game.ready ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== input.generation ||
        !game.user?.isGM ||
        game.users.get(game.user.id) !== game.user ||
        game.users.activeGM !== game.user ||
        game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
        (input.baseline && game.user.id !== input.baseline.gm.id)
      )
        throw Error('Exact sole canonical native GM required');
      if (input.baseline && game.time.worldTime !== input.baseline.worldTime)
        throw Error('World time changed');
    },
    roots() {
      return Object.fromEntries(
        [
          'actors',
          'items',
          'journal',
          'scenes',
          'combats',
          'tables',
          'playlists',
          'macros',
          'messages',
        ].map((key) => [key, game[key].contents.map((d: any) => d.uuid).sort()]),
      );
    },
    queue() {
      const raw = localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`),
        rows = raw === null ? [] : (JSON.parse(raw)[game.user.id] ?? []);
      if (!Array.isArray(rows)) throw Error('Approval queue unavailable');
      return rows;
    },
    audit() {
      const selected = game.settings.get('agent-gateway', 'auditJournalId'),
        anchor = game.settings.storage.get('world').getSetting('agent-gateway.auditJournalId'),
        audit = game.journal.get(selected);
      if (
        anchor?.value !== selected ||
        anchor.user !== null ||
        !game.users.get(anchor._stats?.lastModifiedBy)?.isGM ||
        audit?.flags?.['agent-gateway']?.auditJournal !== true ||
        audit.ownership.default !== 0 ||
        game.users.some((u: any) => !u.isGM && audit.getUserLevel(u) !== 0) ||
        !game.documentTypes.JournalEntryPage.includes('agent-gateway.audit')
      )
        throw Error('Trusted private native audit required');
      const pins = g.__task27Pins?.get(input.run);
      if (
        input.baseline &&
        (!pins ||
          pins.audit !== audit ||
          pins.anchor !== anchor ||
          pins.anchorSource !== JSON.stringify(anchor) ||
          selected !== input.baseline.auditJournalId)
      )
        throw Error('Canonical audit anchor changed');
      return { audit, anchor, selected };
    },
    owned(d: any, type: string, collection: any) {
      if (
        !d ||
        d.documentName !== type ||
        d.parent ||
        d.pack ||
        collection.get(d.id) !== d ||
        d.uuid !== `${type}.${d.id}` ||
        d.flags?.world?.task27 !== input.run ||
        input.baseline.roots[type === 'Actor' ? 'actors' : 'scenes'].includes(d.uuid)
      )
        throw Error('Exact fresh canonical fixture custody required');
    },
    source(d: any, raw = false) {
      const json = JSON.stringify(raw ? d._source : d.toObject());
      if (json.length > 1024 * 1024) throw Error('Fixture source bound exceeded');
      const source = JSON.parse(json);
      delete source._stats;
      // v13 lazily expands an empty linked ActorDelta; compare only its proven empty forms.
      if (input.generation === 13) {
        const rows =
          d.documentName === 'Scene'
            ? source.tokens
            : raw && d.documentName === 'Token'
              ? [source]
              : [];
        for (const row of rows ?? []) {
          const token = d.documentName === 'Scene' ? d.tokens.get(row._id) : d;
          if (
            !token ||
            token.id !== row._id ||
            token.parent?.tokens.get(token.id) !== token ||
            (d.documentName === 'Scene' && token.parent !== d) ||
            token.actorLink !== true ||
            row.actorLink !== true ||
            row.actorId !== token.actorId ||
            row.delta === null ||
            !row.delta ||
            typeof row.delta !== 'object' ||
            Array.isArray(row.delta)
          )
            continue;
          const empty = {
            _id: row._id,
            system: {},
            flags: {},
            name: null,
            type: null,
            img: null,
            items: [],
            effects: [],
            ownership: null,
          };
          const keys = Object.keys(row.delta);
          if (
            (keys.length === 1 && keys[0] === '_id' && row.delta._id === row._id) ||
            (keys.length === Object.keys(empty).length &&
              Object.keys(empty).every(
                (key) => JSON.stringify(row.delta[key]) === JSON.stringify((empty as any)[key]),
              ))
          )
            row.delta = null;
        }
      }
      return source;
    },
    pin(d: any) {
      const pins = g.__task27Pins.get(input.run);
      (pins.documents ??= new Map()).set(d.uuid, {
        doc: d,
        source: JSON.stringify(guards.source(d)),
      });
    },
    pinned(d: any) {
      const pin = g.__task27Pins.get(input.run).documents?.get(d.uuid);
      if (!pin || pin.doc !== d || pin.source !== JSON.stringify(guards.source(d)))
        throw Error('Exact returned fixture identity/source changed');
    },
    renamed(d: any, name: string) {
      const pins = g.__task27Pins.get(input.run),
        root = d.parent ?? d,
        pin = pins.documents.get(root.uuid),
        expected = JSON.parse(pin.source);
      if (d.parent) {
        const child = expected.tokens.find((t: any) => t._id === d.id);
        if (!child) throw Error('Unexpected Token patch');
        child.name = name;
      } else expected.name = name;
      if (JSON.stringify(expected) !== JSON.stringify(guards.source(root)))
        throw Error('Unexpected native fixture mutation');
      guards.pin(root);
      if (d.parent) guards.pin(d);
    },
    fixture() {
      const actors = game.actors.contents.filter((d: any) => d.flags?.world?.task27 === input.run),
        scenes = game.scenes.contents.filter((d: any) => d.flags?.world?.task27 === input.run);
      if (actors.length !== 1 || scenes.length !== 1)
        throw Error('Exact fixture Actor and Scene required');
      const actor = actors[0],
        scene = scenes[0];
      guards.owned(actor, 'Actor', game.actors);
      guards.owned(scene, 'Scene', game.scenes);
      guards.pinned(actor);
      guards.pinned(scene);
      if (
        actor.type !== 'npc' ||
        actor.items.size ||
        actor.effects.size ||
        scene.active ||
        scene.tokens.size !== 2 ||
        (input.generation === 14 ? scene.levels.size !== 1 : scene.levels?.size)
      )
        throw Error('Unexpected fixture subtree or lifecycle automation');
      for (const token of scene.tokens)
        if (
          token.parent !== scene ||
          scene.tokens.get(token.id) !== token ||
          token.actor !== actor ||
          token.actorId !== actor.id ||
          token.actorLink !== true ||
          token.flags?.world?.task27 !== input.run
        )
          throw Error('Exact linked fixture Tokens required');
      for (const token of scene.tokens) guards.pinned(token);
      if (input.generation === 14) {
        const level = scene.levels.get('task27ground0001');
        if (!level || level.parent !== scene || scene.initialLevel !== level)
          throw Error('Exact native Level binding required');
        guards.pinned(level);
        for (const token of scene.tokens)
          if (token.level !== level.id) throw Error('Token Level mismatch');
      }
      return { actor, scene };
    },
  };
  guards.gm();
  if (input.op === 'baseline') {
    if (
      game.modules.contents.some((m: any) => m.active && m.id !== 'agent-gateway') ||
      !game.modules.get('agent-gateway')?.active ||
      !Number.isFinite(game.time.worldTime)
    )
      throw Error('Isolated bounded native baseline required');
    if (
      guards
        .queue()
        .some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Existing pending or running approvals');
    const players = input.names.map((name: string) => {
      const matches = game.users.filter((u: any) => u.name === name && !u.isGM);
      if (matches.length !== 1) throw Error('Exact unique native participants required');
      return { id: matches[0].id, name: matches[0].name };
    });
    if (players[0].id === players[1].id) throw Error('Distinct players required');
    const { audit, anchor, selected } = guards.audit();
    (g.__task27Pins ??= new Map()).set(input.run, {
      audit,
      anchor,
      anchorSource: JSON.stringify(anchor),
    });
    const sources: any[] = [];
    for (const key of [
      'actors',
      'items',
      'journal',
      'scenes',
      'combats',
      'tables',
      'playlists',
      'macros',
      'messages',
    ]) {
      if (game[key].size > 1000) throw Error('Native inventory exceeds proof bound');
      for (const d of game[key])
        if (d !== audit) {
          const source = JSON.stringify(d.toObject());
          if (source.length > 1024 * 1024) throw Error('Native source exceeds proof bound');
          sources.push({ key, uuid: d.uuid, source });
        }
    }
    return {
      gm: { id: game.user.id, name: game.user.name },
      players,
      version: game.version,
      generation: game.release.generation,
      worldTime: game.time.worldTime,
      roots: guards.roots(),
      sources,
      auditJournalId: selected,
      audits: audit.pages.contents.map((p: any) => p.uuid),
      policy: game.settings.get('agent-gateway', 'worldPolicy'),
    };
  }
  guards.audit();
  if (input.op === 'audits')
    return guards
      .audit()
      .audit.pages.contents.map((p: any) => ({ uuid: p.uuid, ...p.system.toObject() }));
  if (input.op === 'queue') return guards.queue();
  if (input.op === 'create') {
    const actor = await g.CONFIG.Actor.documentClass.create(input.plan.actor, {
      renderSheet: false,
    });
    guards.gm();
    guards.owned(actor, 'Actor', game.actors);
    guards.pin(actor);
    const scene = await g.CONFIG.Scene.documentClass.create(input.plan.scene, {
      renderSheet: false,
    });
    guards.gm();
    guards.owned(scene, 'Scene', game.scenes);
    guards.pin(scene);
    const tokens = await scene.createEmbeddedDocuments(
      'Token',
      input.plan.tokens.map((t: any) => ({
        ...t,
        actorId: actor.id,
        actorLink: true,
        width: 1,
        height: 1,
        ...(input.generation === 14 ? { level: 'task27ground0001' } : {}),
        flags: { world: { task27: input.run } },
      })),
      { render: false },
    );
    guards.gm();
    if (
      tokens.length !== 2 ||
      scene.tokens.size !== 2 ||
      tokens.some(
        (t: any, i: number) =>
          t.parent !== scene || scene.tokens.get(t.id) !== t || scene.tokens.contents[i] !== t,
      )
    )
      throw Error('Token creation did not return exact native children');
    const scenePin = g.__task27Pins.get(input.run).documents.get(scene.uuid),
      expected = JSON.parse(scenePin.source);
    // Parent Scene exports raw embedded source; linked v13 Token exports delta:null.
    // Compare the matching raw representations, while independently pinning each child export.
    expected.tokens = tokens.map((t: any) => guards.source(t, true));
    if (JSON.stringify(expected) !== JSON.stringify(guards.source(scene)))
      throw Error('Unexpected Token creation side effect');
    guards.pin(scene);
    for (const token of tokens) guards.pin(token);
    if (input.generation === 14) for (const level of scene.levels) guards.pin(level);
    guards.fixture();
    if (tokens.length !== 2 || tokens.some((t: any) => scene.tokens.get(t.id) !== t))
      throw Error('Token creation did not return exact native children');
    return {
      actor: actor.uuid,
      scene: scene.uuid,
      tokens: tokens.map((t: any) => t.uuid),
      levels: input.generation === 14 ? scene.levels.contents.map((l: any) => l.uuid) : [],
      source: { actor: actor.toObject(), scene: scene.toObject() },
    };
  }
  if (input.op === 'update') {
    const { actor, scene } = guards.fixture();
    if (input.phase === 'coalesce') {
      const start = Date.now();
      await actor.update({ name: input.plan.actorNames[0] });
      guards.renamed(actor, input.plan.actorNames[0]);
      guards.gm();
      guards.fixture();
      const first = Date.now();
      await actor.update({ name: input.plan.actorNames[1] });
      guards.renamed(actor, input.plan.actorNames[1]);
      guards.gm();
      guards.fixture();
      const second = Date.now();
      if (second - start >= 500) throw Error('Native updates missed the coalesce window');
      return { start, first, second, name: actor.name };
    }
    if (input.phase === 'pending' || input.phase === 'reconnected') {
      await actor.update({ name: input.plan.actorNames[input.phase === 'pending' ? 2 : 3] });
      guards.renamed(actor, input.plan.actorNames[input.phase === 'pending' ? 2 : 3]);
      guards.gm();
      guards.fixture();
      return { acknowledgedAt: Date.now(), name: actor.name };
    }
    if (input.phase === 'tokens') {
      for (let i = 0; i < 2; i++) {
        const token = scene.tokens.get(input.ids.tokens[i].split('.').at(-1));
        if (!token || token.hidden !== (i === 1)) throw Error('Exact Token update target required');
        await token.update({ name: input.plan.tokenNames[i] });
        guards.renamed(token, input.plan.tokenNames[i]);
        guards.gm();
        guards.fixture();
      }
      return {
        tokens: scene.tokens.contents.map((t: any) => ({
          uuid: t.uuid,
          name: t.name,
          hidden: t.hidden,
        })),
      };
    }
    throw Error('Unplanned fixture update refused');
  }
  if (input.op === 'private') {
    guards.fixture();
    const whisper = await g.CONFIG.ChatMessage.documentClass.create({
      content: input.plan.whisper,
      whisper: [game.user.id],
      flags: { world: { task27: input.run } },
    });
    guards.gm();
    guards.pin(whisper);
    const roll = await new g.Roll('1').evaluate();
    guards.gm();
    const blind = await g.CONFIG.ChatMessage.documentClass.create({
      content: input.plan.blind,
      whisper: [game.user.id],
      blind: true,
      rolls: [roll],
      flags: { world: { task27: input.run } },
    });
    guards.gm();
    guards.pin(blind);
    if (
      !blind.blind ||
      !blind.isRoll ||
      whisper.blind ||
      [whisper, blind].some(
        (m: any) => JSON.stringify([...m.whisper]) !== JSON.stringify([game.user.id]),
      )
    )
      throw Error('Native GM-only chat privacy source mismatch');
    if (game.messages.get(whisper.id) !== whisper || game.messages.get(blind.id) !== blind)
      throw Error('Native private messages unavailable');
    return { whisper: whisper.uuid, blind: blind.uuid };
  }
  if (input.op === 'bindPublic') {
    const message = game.messages.get(input.publicUuid.split('.').at(-1));
    if (
      !message ||
      message.uuid !== input.publicUuid ||
      input.baseline.roots.messages.includes(message.uuid) ||
      message.author?.id !== input.baseline.gm.id ||
      message.flags?.['agent-gateway']?.ai !== true ||
      message.whisper.length ||
      !message.content.includes(input.plan.prefix)
    )
      throw Error('Exact correlated public message required');
    guards.pin(message);
    return { uuid: message.uuid };
  }
  if (input.op === 'facts') {
    const { actor, scene } = guards.fixture();
    return {
      actor: { uuid: actor.uuid, name: actor.name },
      scene: { uuid: scene.uuid, active: scene.active },
      tokens: scene.tokens.contents.map((t: any) => ({
        uuid: t.uuid,
        name: t.name,
        hidden: t.hidden,
      })),
      worldTime: game.time.worldTime,
    };
  }
  if (input.op === 'cleanup') {
    if (
      JSON.stringify(game.settings.get('agent-gateway', 'worldPolicy')) !==
      JSON.stringify(input.baseline.policy)
    )
      throw Error('World policy changed');
    if (
      guards
        .queue()
        .some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Unsettled call: manual reconciliation required');
    const roots = [
      ...game.actors.contents.filter((d: any) => d.flags?.world?.task27 === input.run),
      ...game.scenes.contents.filter((d: any) => d.flags?.world?.task27 === input.run),
    ];
    if (
      roots.filter((d: any) => d.documentName === 'Actor').length > 1 ||
      roots.filter((d: any) => d.documentName === 'Scene').length > 1
    )
      throw Error('Ambiguous root custody');
    const messages = game.messages.contents.filter(
      (d: any) => d.flags?.world?.task27 === input.run || input.publicUuid === d.uuid,
    );
    if (messages.length > 3) throw Error('Ambiguous message custody');
    for (const d of roots) {
      guards.pinned(d);
      if (d.documentName === 'Scene') {
        for (const t of d.tokens) guards.pinned(t);
        if (input.generation === 14) for (const l of d.levels) guards.pinned(l);
      }
      guards.owned(d, d.documentName, d.documentName === 'Scene' ? game.scenes : game.actors);
      if (d.documentName === 'Actor') {
        if (
          d.type !== 'npc' ||
          d.items.size ||
          d.effects.size ||
          ![input.plan.actor.name, ...input.plan.actorNames].includes(d.name)
        )
          throw Error('Unexpected Actor fixture subtree');
      } else {
        if (
          d.active ||
          d.name !== input.plan.scene.name ||
          d.tokens.size > 2 ||
          ['tiles', 'drawings', 'walls', 'lights', 'sounds', 'notes', 'templates', 'regions'].some(
            (key) => d[key]?.size,
          ) ||
          (input.generation === 14 ? d.levels.size !== 1 : d.levels?.size)
        )
          throw Error('Unexpected Scene fixture subtree');
        for (const t of d.tokens)
          if (
            t.parent !== d ||
            t.flags?.world?.task27 !== input.run ||
            !roots.some((a: any) => a.documentName === 'Actor' && a.id === t.actorId) ||
            !t.actorLink
          )
            throw Error('Unexpected child Token custody');
      }
    }
    for (const saved of input.baseline.sources) {
      const d = game[saved.key].contents.find((row: any) => row.uuid === saved.uuid);
      if (!d || JSON.stringify(d.toObject()) !== saved.source)
        throw Error('Original native source changed before cleanup');
    }
    for (const m of messages) {
      guards.pinned(m);
      if (
        game.messages.get(m.id) !== m ||
        input.baseline.roots.messages.includes(m.uuid) ||
        m.author?.id !== input.baseline.gm.id ||
        (m.uuid === input.publicUuid
          ? m.flags?.['agent-gateway']?.ai !== true || !m.content.includes(input.plan.prefix)
          : m.flags?.world?.task27 !== input.run ||
            JSON.stringify([...m.whisper]) !== JSON.stringify([input.baseline.gm.id]))
      )
        throw Error('Exact nonce message custody required');
      guards.gm();
      await m.delete();
      guards.gm();
      if (game.messages.get(m.id)) throw Error('Message deletion incomplete');
    }
    for (const d of roots.sort((a: any) => (a.documentName === 'Scene' ? -1 : 1))) {
      const collection = d.documentName === 'Scene' ? game.scenes : game.actors;
      guards.owned(d, d.documentName, collection);
      guards.pinned(d);
      if (d.documentName === 'Scene') {
        for (const t of d.tokens) guards.pinned(t);
        if (input.generation === 14) for (const l of d.levels) guards.pinned(l);
      }
      guards.gm();
      await d.delete({ render: false });
      guards.gm();
      if (collection.get(d.id)) throw Error('Root deletion incomplete');
    }
    if (JSON.stringify(guards.roots()) !== JSON.stringify(input.baseline.roots))
      throw Error('Original root sets changed');
    for (const saved of input.baseline.sources) {
      const d = game[saved.key].contents.find((row: any) => row.uuid === saved.uuid);
      if (!d || JSON.stringify(d.toObject()) !== saved.source)
        throw Error('Original native source changed');
    }
    const pages = guards.audit().audit.pages.contents;
    if (input.audits.some((uuid: string) => !pages.some((p: any) => p.uuid === uuid)))
      throw Error('Retained audit missing');
    return {
      absent: input.expectedUUIDs.filter(
        (uuid: string) =>
          !game.actors.contents.some((d: any) => d.uuid === uuid) &&
          !game.scenes.contents.some(
            (d: any) =>
              d.uuid === uuid ||
              d.tokens.contents.some((t: any) => t.uuid === uuid) ||
              d.levels?.contents.some((l: any) => l.uuid === uuid),
          ) &&
          !game.messages.contents.some((d: any) => d.uuid === uuid),
      ).length,
      auditsRetained: input.audits.length,
      worldTimeUnchanged: true,
      rootsUnchanged: true,
      sourcesUnchanged: true,
    };
  }
  throw Error('Unsupported native proof operation');
}

/** Self-contained local view helper, pinned to the exact three native participants. */
export async function task27ParticipantState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    user() {
      if (
        !game.ready ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== input.generation ||
        game.users.get(game.user?.id) !== game.user ||
        game.user.id !== input.user.id ||
        game.user.isGM !== input.isGM ||
        game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
        game.users.activeGM?.id !== input.gmId
      )
        throw Error('Exact native participant identity required');
      if (game.time.worldTime !== input.worldTime) throw Error('Native time changed');
    },
    view() {
      return {
        sceneId: g.canvas.scene?.id ?? null,
        levelId: g.canvas.level?.id ?? null,
        targets: [...game.user.targets].map((t: any) => t.id).sort(),
        combatUuid: g.ui.combat?.viewed?.uuid ?? null,
        activeScenes: game.scenes.contents
          .filter((s: any) => s.active)
          .map((s: any) => s.id)
          .sort(),
      };
    },
  };
  guards.user();
  if (input.op === 'baseline') {
    const view = guards.view();
    (g.__task27ParticipantPins ??= new Map()).set(input.run, {
      view,
      scene: g.canvas.scene,
      combat: g.ui.combat?.viewed,
    });
    return { user: { id: game.user.id, name: game.user.name, isGM: game.user.isGM }, view };
  }
  const pins = g.__task27ParticipantPins?.get(input.run);
  if (!pins || JSON.stringify(pins.view) !== JSON.stringify(input.baseline.view))
    throw Error('Native view baseline custody unavailable');
  const scene = game.scenes.get(input.sceneUuid.split('.').at(-1));
  if (
    !scene ||
    scene.uuid !== input.sceneUuid ||
    scene.flags?.world?.task27 !== input.run ||
    scene.active ||
    scene.testUserPermission(game.user, 'OBSERVER') !== true
  )
    throw Error('Exact inactive fixture Scene required');
  if (input.op === 'view') {
    if (JSON.stringify(guards.view()) !== JSON.stringify(pins.view))
      throw Error('Local view changed before fixture view');
    const result = await scene.view();
    guards.user();
    if (
      result !== scene ||
      !g.canvas.ready ||
      g.canvas.scene !== scene ||
      JSON.stringify(guards.view().activeScenes) !== JSON.stringify(pins.view.activeScenes)
    )
      throw Error('Native local fixture view failed');
    pins.fixtureView = guards.view();
    return { view: pins.fixtureView };
  }
  if (input.op === 'facts') {
    if (!g.canvas.ready || g.canvas.scene !== scene) throw Error('Fixture view not rendered');
    return {
      userId: game.user.id,
      view: guards.view(),
      tokens: scene.tokens.contents.map((t: any) => ({
        uuid: t.uuid,
        hidden: t.hidden,
        name: t.name,
        rendered: t._object?.destroyed === false,
        visible: t._object?.isVisible === true,
      })),
      messages: input.messageUUIDs.map((uuid: string) => {
        const m = game.messages.get(uuid.split('.').at(-1));
        if (!m || m.uuid !== uuid) throw Error('Exact native message missing');
        return {
          uuid,
          contentVisible: m.isContentVisible === true,
          visible: m.visible === true,
          isRoll: m.isRoll === true,
        };
      }),
    };
  }
  if (input.op === 'restore') {
    if (!pins.fixtureView || JSON.stringify(guards.view()) !== JSON.stringify(pins.fixtureView))
      throw Error('External local view change: manual reconciliation required');
    if (pins.scene) {
      if (game.scenes.get(pins.scene.id) !== pins.scene)
        throw Error('Original canonical Scene changed');
      const result = await pins.scene.view(pins.view.levelId ? { level: pins.view.levelId } : {});
      guards.user();
      if (result !== pins.scene || g.canvas.scene !== pins.scene)
        throw Error('Original view restoration failed');
    } else {
      await g.canvas.draw(null);
      guards.user();
    }
    guards.user();
    if (pins.combat && game.combats.get(pins.combat.id) !== pins.combat)
      throw Error('Original canonical Combat changed');
    g.canvas.tokens.setTargets(pins.view.targets, { mode: 'replace' });
    g.ui.combat.viewed = pins.combat ?? null;
    if (JSON.stringify(guards.view()) !== JSON.stringify(pins.view))
      throw Error('Exact native views not restored');
    return { restored: true, view: guards.view() };
  }
  throw Error('Unsupported participant operation');
}
