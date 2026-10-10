export type FoundryTarget = 'v13' | 'v14';

export interface RunArgs {
  foundry: FoundryTarget;
  /** Arguments after `--` go to vitest unchanged. */
  rest: string[];
}

export class ArgError extends Error {}

export function parseRunArgs(argv: readonly string[]): RunArgs {
  let foundry: FoundryTarget = 'v14';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    let value: string | undefined;
    if (a === '--foundry') {
      value = argv[++i];
      if (value === undefined) throw new ArgError('--foundry needs a value: v13 or v14');
    } else if (a.startsWith('--foundry=')) {
      value = a.slice('--foundry='.length);
    } else {
      rest.push(a);
      continue;
    }
    if (value !== 'v13' && value !== 'v14') {
      throw new ArgError(`--foundry must be v13 or v14, got "${value}"`);
    }
    foundry = value;
  }
  return { foundry, rest };
}

export const V13_SKIP_MESSAGE = 'SKIP: v13 instance not configured (set AGENT_GATEWAY_E2E_V13_URL)';

export interface SetupArgs {
  /** Also pair the second player (needed by the multi-user suites). */
  includePlayer2: boolean;
  only: string[];
}

export function parseSetupArgs(argv: readonly string[]): SetupArgs {
  const out: SetupArgs = { includePlayer2: false, only: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--player2') out.includePlayer2 = true;
    else if (a === '--only') {
      const v = argv[++i];
      if (v === undefined) throw new ArgError('--only needs a user name');
      out.only.push(v);
    } else throw new ArgError(`unknown option ${a}`);
  }
  return out;
}
