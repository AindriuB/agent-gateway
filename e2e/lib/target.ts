import { V13_SKIP_MESSAGE, type FoundryTarget } from './args.js';
import { withFoundryUrl, type E2eConfig } from './config.js';

export type Target = { kind: 'skip'; message: string } | { kind: 'run'; config: E2eConfig };

/** `--foundry v14` (default) targets FOUNDRY_URL; `--foundry v13` needs AGENT_GATEWAY_E2E_V13_URL. */
export function chooseTarget(foundry: FoundryTarget, config: E2eConfig): Target {
  if (foundry === 'v14') return { kind: 'run', config };
  if (!config.v13Url) return { kind: 'skip', message: V13_SKIP_MESSAGE };
  return { kind: 'run', config: withFoundryUrl(config, config.v13Url) };
}
