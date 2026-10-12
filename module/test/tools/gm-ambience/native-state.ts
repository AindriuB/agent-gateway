/* eslint-disable @typescript-eslint/no-explicit-any */
/** Self-contained browser callback. Mutations are restricted to explicitly approved nonce-owned fixtures. */
export async function task25NativeState(input: any): Promise<any> {
  const g = globalThis as any,
    game = g.game;
  const guards = {
    gm() {
      if (
        !game.ready ||
        game.world.id !== 'test-world' ||
        Number(game.release.generation) !== input.generation ||
        !game.user.isGM ||
        game.users.get(game.user.id) !== game.user ||
        game.users.activeGM !== game.user ||
        game.users.filter((u: any) => u.active && u.isGM).length !== 1 ||
        (input.baseline && game.user.id !== input.baseline.gm.id)
      )
        throw Error('Current sole canonical GM prerequisite failed');
    },
    roots() {
      return [...game.tables.contents, ...game.playlists.contents];
    },
    canonical(d: any) {
      return (
        d &&
        !d.parent &&
        !d.pack &&
        ['RollTable', 'Playlist'].includes(d.documentName) &&
        game[d.documentName === 'RollTable' ? 'tables' : 'playlists'].get(d.id) === d &&
        d.uuid === `${d.documentName}.${d.id}`
      );
    },
    owned(d: any) {
      if (
        !this.canonical(d) ||
        d.flags?.world?.task25 !== input.run ||
        input.baseline.roots.includes(d.uuid)
      )
        throw Error('Exact fresh canonical fixture custody required');
    },
  };
  guards.gm();
  if (input.op === 'baseline') {
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
      throw Error('Trusted private native audit prerequisite failed');
    const queue =
      JSON.parse(localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`) ?? '{}')[
        game.user.id
      ] ?? [];
    if (
      !Array.isArray(queue) ||
      queue.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result))
    )
      throw Error('Existing pending/running approval');
    if (game.modules.contents.some((m: any) => m.active && m.id !== 'agent-gateway'))
      throw Error('Additional modules prevent isolated proof');
    const matches = [input.playerName, input.player2Name].map((name) =>
      game.users.filter((u: any) => u.name.toLowerCase() === name.toLowerCase()),
    );
    if (matches.some((rows) => rows.length !== 1 || rows[0].isGM))
      throw Error('Exact player identities required');
    const pack = game.packs.get('pf2e.equipment-srd');
    if (
      !pack ||
      !pack.testUserPermission(game.user, 'OBSERVER') ||
      matches.some((rows) => !pack.testUserPermission(rows[0], 'OBSERVER'))
    )
      throw Error('Public source pack unavailable');
    const index = await pack.getIndex();
    guards.gm();
    const entry = index.find((r: any) => r.name === 'Dagger' && r.type === 'weapon');
    if (!entry) throw Error('Public source reference unavailable');
    const source = await pack.getDocument(entry._id);
    guards.gm();
    if (
      !source ||
      source.documentName !== 'Item' ||
      source.pack !== pack.collection ||
      game.packs.get(pack.collection) !== pack
    )
      throw Error('Canonical public Item reference unavailable');
    const asset = await fetch(new URL('sounds/lock.wav', location.origin), { method: 'HEAD' });
    guards.gm();
    if (!asset.ok) throw Error('Approved existing audio asset unavailable');
    return {
      gm: { id: game.user.id, name: game.user.name },
      players: matches.map((rows) => ({ id: rows[0].id, name: rows[0].name })),
      version: game.version,
      worldTime: game.time.worldTime,
      roots: guards.roots().map((d: any) => d.uuid),
      sources: guards.roots().map((d: any) => ({ uuid: d.uuid, source: d.toObject() })),
      messages: game.messages.contents.map((d: any) => d.uuid),
      audits: audit.pages.contents.map((p: any) => p.uuid),
      reference: { uuid: source.uuid, source: source.toObject() },
      asset: 'sounds/lock.wav',
    };
  }
  if (input.baseline && game.time.worldTime !== input.baseline.worldTime)
    throw Error('World time changed');
  if (input.op === 'create') {
    const d = await g.CONFIG[input.type].documentClass.create(input.source, { renderSheet: false });
    guards.gm();
    guards.owned(d);
    const rows = input.type === 'RollTable' ? d.results.contents : d.sounds.contents;
    if (
      rows.length !== 2 ||
      rows.some(
        (r: any) =>
          r.parent !== d || d[input.type === 'RollTable' ? 'results' : 'sounds'].get(r.id) !== r,
      )
    )
      throw Error('Exact two canonical embedded fixture identities required');
    return {
      uuid: d.uuid,
      children: rows.map((r: any) => ({
        uuid: r.uuid,
        id: r.id,
        name: r.name,
        source: r.toObject(),
      })),
    };
  }
  if (input.op === 'reset') {
    const table = await g.fromUuid(input.ids.table);
    guards.gm();
    guards.owned(table);
    if (table.results.contents.length !== 2 || table.results.contents.some((r: any) => !r.drawn))
      throw Error('First nonreplacement draw was not complete');
    const result = await table.update(
      {
        replacement: true,
        results: table.results.contents.map((r: any) => ({ _id: r.id, drawn: false })),
      },
      { render: false },
    );
    guards.gm();
    guards.owned(table);
    if (result !== table || !table.replacement || table.results.contents.some((r: any) => r.drawn))
      throw Error('Fixture-only replacement reset did not persist');
    return { reset: true };
  }
  if (input.op === 'facts') {
    const table = await g.fromUuid(input.ids.table),
      playlist = await g.fromUuid(input.ids.playlist);
    guards.gm();
    guards.owned(table);
    guards.owned(playlist);
    const sounds = playlist.sounds.contents;
    if (
      JSON.stringify(sounds.map((s: any) => s.id).sort()) !==
      JSON.stringify([...input.ids.sounds].sort())
    )
      throw Error('Exact captured sound identities changed');
    if (
      input.ids.results &&
      JSON.stringify(table.results.contents.map((r: any) => r.id).sort()) !==
        JSON.stringify([...input.ids.results].sort())
    )
      throw Error('Exact captured result identities changed');
    if (
      sounds.length !== 2 ||
      sounds.some(
        (s: any) =>
          s.parent !== playlist ||
          playlist.sounds.get(s.id) !== s ||
          s.path !== 'sounds/lock.wav' ||
          s.repeat !== true,
      )
    )
      throw Error('Exact native fixture sound relationship changed');
    const playing = sounds.filter((s: any) => s.playing).map((s: any) => s.id);
    if (input.index === 0 && table.results.contents.some((r: any) => !r.drawn))
      throw Error('Nonreplacement drawn flags missing');
    if (
      input.index >= 1 &&
      (!table.replacement || table.results.contents.some((r: any) => r.drawn))
    )
      throw Error('Replacement draw altered drawn flags');
    if (input.index < 5 && sounds.some((s: any) => s.volume !== 0))
      throw Error('Playback must remain muted');
    if (input.index === 2 && (playing.length !== 1 || playing[0] !== input.ids.sounds[0]))
      throw Error('Native first-track playback mismatch');
    if (input.index === 3 && (playing.length !== 1 || playing[0] !== input.ids.sounds[1]))
      throw Error('Native next-track playback mismatch');
    if (input.index >= 4 && (playing.length || playlist.playing))
      throw Error('Fixture playlist must be completely stopped');
    if (input.index >= 5 && sounds.some((s: any) => s.volume !== 0.25))
      throw Error('Stopped-only volume update missing');
    const newMessages = game.messages.contents.filter(
      (m: any) => !input.baseline.messages.includes(m.uuid),
    );
    if (input.index === 0 && newMessages.length) throw Error('No-chat draw created a message');
    if (
      input.index >= 1 &&
      (newMessages.length !== 1 ||
        newMessages[0].flags?.['agent-gateway']?.ai !== true ||
        newMessages[0].blind !== true ||
        JSON.stringify([...newMessages[0].whisper].sort()) !==
          JSON.stringify(
            game.users
              .filter((u: any) => u.isGM)
              .map((u: any) => u.id)
              .sort(),
          ))
    )
      throw Error('Exact private AI-marked native chat mismatch');
    if (
      newMessages[0] &&
      (!newMessages[0].content.includes(`ag-task25-${input.run} &amp; text`) ||
        !newMessages[0].content.includes(`ag-task25-${input.run} reference`) ||
        /<(?:b|script|iframe|img)[\s>]/i.test(newMessages[0].content))
    )
      throw Error('Native chat result text mismatch');
    return {
      worldTime: game.time.worldTime,
      table: table.toObject(),
      playlist: playlist.toObject(),
      message: newMessages[0]
        ? { uuid: newMessages[0].uuid, source: newMessages[0].toObject() }
        : null,
    };
  }
  if (input.op === 'cleanup') {
    const queue =
      JSON.parse(localStorage.getItem(`agent-gateway.${game.world.id}.approvalQueue`) ?? '{}')[
        game.user.id
      ] ?? [];
    if (queue.some((r: any) => r.status === 'pending' || (r.status === 'approved' && !r.result)))
      throw Error('Pending/running calls prevent cleanup');
    const current = guards.roots();
    const owned = current.filter(
      (d: any) => d.flags?.world?.task25 === input.run && !input.baseline.roots.includes(d.uuid),
    );
    for (const d of owned) guards.owned(d);
    // Recover only independently nonce-owned fresh roots; never guess an existing source by name.
    for (const d of owned.filter((d: any) => d.documentName === 'Playlist')) {
      guards.gm();
      guards.owned(d);
      await d.update(
        {
          playing: false,
          sounds: d.sounds.contents.map((s: any) => ({
            _id: s.id,
            playing: false,
            volume: 0,
            pausedTime: null,
          })),
        },
        { render: false },
      );
      guards.gm();
      guards.owned(d);
      await d.delete({ render: false });
      guards.gm();
      if (game.playlists.get(d.id)) throw Error('Fixture Playlist deletion failed');
    }
    for (const d of owned.filter((d: any) => d.documentName === 'RollTable')) {
      guards.gm();
      guards.owned(d);
      await d.delete({ render: false });
      guards.gm();
      if (game.tables.get(d.id)) throw Error('Fixture RollTable deletion failed');
    }
    for (const uuid of input.messages) {
      const m = await g.fromUuid(uuid);
      guards.gm();
      if (m) {
        if (
          input.baseline.messages.includes(uuid) ||
          m.documentName !== 'ChatMessage' ||
          game.messages.get(m.id) !== m ||
          m.flags?.['agent-gateway']?.ai !== true ||
          !m.content.includes(`ag-task25-${input.run}`)
        )
          throw Error('Created chat custody unproven');
        await m.delete({ render: false });
        guards.gm();
      }
    }
    for (const uuid of input.created)
      if (await g.fromUuid(uuid)) throw Error('Exact fixture identity remains');
    guards.gm();
    const finalRoots = guards
      .roots()
      .map((d: any) => d.uuid)
      .sort();
    if (JSON.stringify(finalRoots) !== JSON.stringify([...input.baseline.roots].sort()))
      throw Error('Original table/playlist root set changed');
    for (const saved of input.baseline.sources) {
      const d = await g.fromUuid(saved.uuid);
      guards.gm();
      if (!d || JSON.stringify(d.toObject()) !== JSON.stringify(saved.source))
        throw Error('Original table/playlist source changed');
    }
    if (
      JSON.stringify(game.messages.contents.map((m: any) => m.uuid).sort()) !==
      JSON.stringify([...input.baseline.messages].sort())
    )
      throw Error('Original chat set changed');
    const reference = await g.fromUuid(input.baseline.reference.uuid);
    guards.gm();
    if (
      !reference ||
      JSON.stringify(reference.toObject()) !== JSON.stringify(input.baseline.reference.source)
    )
      throw Error('Public reference source changed');
    if (game.time.worldTime !== input.baseline.worldTime)
      throw Error('World time changed during cleanup');
    return {
      absent: input.created.length,
      auditsRetained: input.audits.length,
      sourceUnchanged: true,
      worldTimeUnchanged: true,
      rootsUnchanged: true,
    };
  }
  throw Error('Unknown native harness operation');
}
