/* eslint-disable @typescript-eslint/no-explicit-any */
import { playlistControl } from '@agent-gateway/protocol';
import { defineWriteHandler, invalid } from './_write.js';
import { actionFields } from './_scene.js';
import { resolveAmbience, checkAmbience, captureAmbience } from './_ambience.js';
declare const CONST: any;
export const playlistControlHandler = defineWriteHandler({
  targets: () => [],
  async run(ctx) {
    const args = playlistControl.input.parse(ctx.args);
    actionFields(
      args,
      ['playlistUuid', ...(args.action === 'set_volume' ? ['volume'] : [])],
      ['soundUuid'],
    );
    const playlist = await resolveAmbience(ctx, args.playlistUuid, 'Playlist');
    const { rows, validate } = captureAmbience(ctx, playlist, 'sounds');
    if (!rows.length) invalid('Playlist has no sounds');
    const selected = args.soundUuid ? rows.find((s) => s.uuid === args.soundUuid) : undefined;
    if (args.soundUuid && !selected) invalid('Sound must belong to the selected playlist');
    const modes = CONST?.PLAYLIST_MODES;
    if (!modes || !Object.values(modes).includes(playlist.mode))
      invalid('Unsupported native playlist mode');
    const sequential = [modes.SEQUENTIAL, modes.SHUFFLE].includes(playlist.mode);
    const data: any = {};
    let options: any = ctx.callOptions;
    if (args.action === 'set_volume') {
      data.sounds = (selected ? [selected] : rows).map((s) => ({ _id: s.id, volume: args.volume }));
    } else if (args.action === 'stop') {
      data.playing = selected ? rows.some((s) => s !== selected && s.playing) : false;
      data.sounds = selected
        ? [{ _id: selected.id, playing: false, pausedTime: null }]
        : rows.map((s) => ({ _id: s.id, playing: false }));
    } else if (args.action === 'next') {
      if (!sequential) invalid('Next requires sequential or shuffle playback');
      const order = playlist.playbackOrder;
      if (
        !Array.isArray(order) ||
        order.length !== rows.length ||
        new Set(order).size !== rows.length ||
        order.some((id) => !rows.some((s) => s.id === id))
      )
        invalid('Native playlist order is unavailable');
      const current = selected ?? rows.find((s) => s.playing);
      const index = order.indexOf(current?.id);
      const next = playlist.playing ? order[(index + 1) % order.length] : undefined;
      data.sounds = rows.map((s) => ({ _id: s.id, playing: s.id === next, pausedTime: null }));
      if (next && next === current?.id)
        options = { diff: false, render: false, forceSync: true, ...ctx.callOptions };
    } else if (selected) {
      data.playing = true;
      data.sounds = sequential
        ? rows.map((s) => ({
            _id: s.id,
            playing: s === selected,
            pausedTime: s === selected ? s.pausedTime : null,
          }))
        : [{ _id: selected.id, playing: true }];
    } else if (playlist.mode === modes.DISABLED) {
      data.playing = false;
    } else if (sequential) {
      const order = playlist.playbackOrder;
      if (
        !Array.isArray(order) ||
        order.length !== rows.length ||
        new Set(order).size !== rows.length ||
        order.some((id) => !rows.some((s) => s.id === id))
      )
        invalid('Native playlist order is unavailable');
      const next = rows.find((s) => s.pausedTime)?.id ?? order[0];
      data.playing = true;
      data.sounds = rows.map((s) => ({ _id: s.id, playing: s.id === next }));
    } else {
      data.playing = true;
      data.sounds = rows.map((s) => ({ _id: s.id, playing: true }));
    }
    validate();
    await ctx.snapshot(playlist.uuid);
    validate();
    const result = await playlist.update(data, options);
    checkAmbience(ctx, playlist, 'Playlist');
    if (result !== playlist) throw new Error('Playlist update did not persist');
    const after = captureAmbience(ctx, playlist, 'sounds');
    if (after.rows.length !== rows.length || rows.some((row) => !after.rows.includes(row)))
      throw new Error('Playlist sound identities changed during update');
    for (const change of data.sounds ?? []) {
      const sound = rows.find((s) => s.id === change._id);
      checkAmbience(ctx, sound, 'PlaylistSound');
      for (const [key, value] of Object.entries(change))
        if (key !== '_id' && sound[key] !== value)
          throw new Error('Playlist sound update did not persist');
    }
    // Native derived playing reflects actual child state, including disabled soundboard mode.
    if (playlist.playing !== rows.some((s) => s.playing))
      throw new Error('Playlist playback state is inconsistent');
    return {
      text: 'Playlist updated; subsequent audio lifecycle callbacks remain native',
      structured: { uuid: playlist.uuid, action: args.action, completed: true },
    };
  },
});
