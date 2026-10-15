import type { Identity } from '../../routing/index.js';

/**
 * The pool a session binds from. Follow mode (no user selector) never sees a headless identity:
 * an agent is reached only by an explicit binding. A session with a user selector keeps the full
 * pool, so `--user <agent id>` and an OAuth grant still bind to an agent that is offline.
 */
export function knownIdentitiesFor(
  selectorUser: string | undefined,
  active: () => readonly Identity[],
  isHeadless: (worldId: string, userId: string) => boolean,
): Identity[] {
  const all = active();
  return selectorUser === undefined
    ? all.filter((i) => !isHeadless(i.worldId, i.userId))
    : [...all];
}
