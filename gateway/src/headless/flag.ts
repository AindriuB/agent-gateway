/** Session-storage key the runner sets before Foundry loads; the module reads it once at load. */
export const HEADLESS_FLAG_KEY = 'agent-gateway.headless';

/** Session-storage key the module mirrors its link state into when the flag is set. */
export const HEADLESS_LINK_KEY = 'agent-gateway.headless.link';
