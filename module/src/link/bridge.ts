import { dispatch as realDispatch } from '../ops/dispatch.js';
import type { DispatchResult, OpCall, OpUser } from '../ops/types.js';
import { isOpError } from '../ops/types.js';
import type { CallHandler, LinkClient } from './client.js';

declare const game: { user?: { id?: unknown; isGM?: unknown } } | undefined;

export interface BridgeDeps {
  dispatch(call: OpCall, user: OpUser): Promise<DispatchResult>;
  /** The user this browser is logged in as. */
  getUser(): { id?: unknown; isGM?: unknown } | undefined;
}

const defaults: BridgeDeps = {
  // The registry/stages/runtime imports form a cycle; resolve the live binding at call time.
  dispatch: (call, user) => realDispatch(call, user),
  getUser: () => (typeof game === 'undefined' ? undefined : game.user),
};

/** Whether calls arriving over the link count as headless. The tool listing uses the same value. */
export const LINK_AGENT_HEADLESS = false;

/**
 * Run inbound link calls through the dispatcher as the local Foundry user. Identity comes only
 * from `game.user`; nothing about who is calling is read from the call frame, which is why the
 * handler below touches only `tool`, `args` and `sessionId` of it.
 */
export function installBridge(client: LinkClient, deps: Partial<BridgeDeps> = {}): void {
  const { dispatch, getUser } = { ...defaults, ...deps };
  const handler: CallHandler = async (frame) => {
    const u = getUser();
    if (!u || typeof u.id !== 'string' || u.id === '') {
      return { ok: false, code: 'INTERNAL', message: 'No Foundry user is logged in' };
    }
    const user: OpUser = { id: u.id, isGM: u.isGM === true };
    const res = await dispatch(
      {
        tool: frame.tool,
        args: frame.args,
        agent: { id: client.agentId ?? '', ownerUserId: user.id, headless: LINK_AGENT_HEADLESS },
        sessionId: frame.sessionId,
      },
      user,
    );
    if (isOpError(res)) return { ok: false, code: res.error.code, message: res.error.message };
    return { ok: true, text: res.text, structured: res.structured };
  };
  client.onCall = handler;
}
