/** Defaults are the native-verified build; overrides must identify an explicitly reviewed build. */
export function task26ProofPins(
  source = '7e626ebe04e5547e1ae5a4491d001e400d61fa8c',
  bundle = 'deadc3daef7d9c4a265f474b2155ca8a4558de51315e9ca5803c0f30ec261aa7',
) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Exact reviewed Task26 source/build pins required');
  return { source, bundle };
}
/** Pure, exact harmless native fixture plan; importing this performs no effects. */
export function task26Plan(run: string, generation: number, macroUuid = '') {
  if (!/^[a-f0-9]{12}$/.test(run) || ![13, 14].includes(generation))
    throw Error('Exact native plan identity required');
  const macroSource = `await Promise.resolve();\nreturn { kind: "macro", generation: game.release.generation, nonce: "${run}", args };`;
  const scriptSource = `await Promise.resolve();\nreturn { kind: "script", generation: game.release.generation, nonce: "${run}" };`;
  return {
    fixture: {
      name: `ag-task26-${run}`,
      type: 'script',
      scope: 'global',
      command: macroSource,
      ownership: { default: 0 },
      flags: { world: { task26: run } },
    },
    calls: [
      {
        tool: 'macro_run',
        args: { macroUuid, args: '{"echo":"native-proof"}' },
        source: macroSource,
        expected: JSON.stringify({
          kind: 'macro',
          generation,
          nonce: run,
          args: { echo: 'native-proof' },
        }),
      },
      {
        tool: 'script_run',
        args: { source: scriptSource },
        source: scriptSource,
        expected: JSON.stringify({ kind: 'script', generation, nonce: run }),
      },
    ],
  };
}
export function assertTask26SourceCard(
  card: { tool: string; args: unknown; source: string; session: boolean },
  expected: ReturnType<typeof task26Plan>['calls'][number],
) {
  const review =
    expected.tool === 'macro_run' ? { ...expected.args, source: expected.source } : expected.args;
  if (
    card.tool !== expected.tool ||
    JSON.stringify(card.args) !== JSON.stringify(review) ||
    card.source !== expected.source ||
    card.session
  )
    throw Error('Exact full-source once-only native approval card mismatch');
}
export function assertTask26Return(
  result: { text: string; failed: boolean; pending: boolean; structured?: unknown },
  expected: string,
) {
  if (result.failed || result.text !== expected)
    throw Error('Exact harmless native code return mismatch');
  if (
    !result.pending &&
    JSON.stringify(result.structured) !== JSON.stringify({ result: expected, truncated: false })
  )
    throw Error('Immediate native structured return mismatch');
}
