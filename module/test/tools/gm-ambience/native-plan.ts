/** Pure explicitly approved fixture plan. Importing this file has no native effects. */
export const task25Source = '4d8b9d1f4520ff3d0a39fbd7f3cc9b045cd0b6b5';
export const task25Bundle = 'ad5438ea93336082f34d9b0e4b962eef6c97eb94370aa7db437947993eb21ae6';
/** Overrides name only a separately reviewed source/build; a valid opt-in never grants world permission. */
export function task25ProofPins(source = task25Source, bundle = task25Bundle) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Exact reviewed source/build pins required');
  return { source, bundle };
}
export function task25FixtureData(run: string, reference: string) {
  if (!/^[a-f0-9]{12}$/.test(run) || !reference.startsWith('Compendium.') || reference.length > 256)
    throw Error('Bounded nonce and canonical public reference required');
  const prefix = `ag-task25-${run}`,
    flags = { world: { task25: run } };
  return {
    table: {
      name: `${prefix}-table`,
      formula: '1d2',
      replacement: false,
      displayRoll: true,
      ownership: { default: 0 },
      flags,
      results: [
        {
          name: `${prefix}-text`,
          type: 'text',
          description: `<b>${prefix} &amp; text</b>`,
          range: [1, 2],
          weight: 1,
          drawn: false,
        },
        {
          name: `${prefix}-reference`,
          type: 'document',
          description: `${prefix} reference`,
          documentUuid: reference,
          range: [1, 2],
          weight: 1,
          drawn: false,
        },
      ],
    },
    playlist: {
      name: `${prefix}-playlist`,
      mode: 0,
      sorting: 'm',
      playing: false,
      ownership: { default: 0 },
      flags,
      sounds: [
        {
          name: `${prefix}-first`,
          path: 'sounds/lock.wav',
          volume: 0,
          repeat: true,
          playing: false,
          pausedTime: null,
          sort: 0,
        },
        {
          name: `${prefix}-second`,
          path: 'sounds/lock.wav',
          volume: 0,
          repeat: true,
          playing: false,
          pausedTime: null,
          sort: 1,
        },
      ],
    },
  };
}
export function task25Calls(ids: { table: string; playlist: string; player: string }, run: string) {
  return [
    {
      tool: 'table_roll',
      args: { tableUuid: ids.table, toChat: false, rollMode: 'publicroll' },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'table_roll',
      args: { tableUuid: ids.table, toChat: true, rollMode: 'blindroll' },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'playlist_control',
      args: { playlistUuid: ids.playlist, action: 'play' },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'playlist_control',
      args: { playlistUuid: ids.playlist, action: 'next' },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'playlist_control',
      args: { playlistUuid: ids.playlist, action: 'stop' },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'playlist_control',
      args: { playlistUuid: ids.playlist, action: 'set_volume', volume: 0.25 },
      expected: 'ok' as const,
      audit: true,
    },
    {
      tool: 'notify',
      args: { message: `<b>ag-task25-${run} notice</b>`, level: 'info', users: [ids.player] },
      expected: 'ok' as const,
      audit: true,
    },
  ];
}
