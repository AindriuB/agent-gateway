import { dispatch as realDispatch } from '../ops/dispatch.js';
import type { DispatchResult, OpCall, OpUser } from '../ops/types.js';
import { ReplayReceipts } from '../approvals/replay.js';
import { canonicalJson } from '../approvals/canonical.js';
import { liveToolMetadata } from '../ops/registry-class.js';
import { bindReplay, isOpError } from '../ops/types.js';
import type { CallHandler, LinkClient } from './client.js';

declare const game:
  { user?: { id?: unknown; isGM?: unknown }; users?: { get(id: unknown): unknown } } | undefined;

export interface BridgeDeps {
  dispatch(call: OpCall, user: OpUser): Promise<DispatchResult>;
  /** The user this browser is logged in as. */
  storage(): Pick<Storage, 'getItem' | 'setItem'>;
  getUser(): { id?: unknown; isGM?: unknown } | undefined;
  /** Does Foundry have a user with this id? Guards the gateway's owner hint. */
  userExists?(id: string): boolean;
}

const defaults: BridgeDeps = {
  userExists: (id) => typeof game !== 'undefined' && !!game.users?.get(id),
  // The registry/stages/runtime imports form a cycle; resolve the live binding at call time.
  dispatch: (call, user) => realDispatch(call, user),
  storage: () => localStorage,
  getUser: () =>
    typeof game === 'undefined' || !game.user || game.users?.get(game.user.id) !== game.user
      ? undefined
      : game.user,
};

/** Session-storage key the gateway's headless runner sets (init script) before Foundry loads. */
export const HEADLESS_FLAG_KEY = 'agent-gateway.headless';

let headlessFlag: boolean | undefined;

/**
 * Whether calls arriving over the link count as headless. Read once from the session flag the
 * runner sets; a human's browser never has it. The tool listing uses the same value.
 */
export function linkAgentHeadless(): boolean {
  if (headlessFlag === undefined) {
    try {
      headlessFlag = globalThis.sessionStorage?.getItem(HEADLESS_FLAG_KEY) === '1';
    } catch {
      headlessFlag = false;
    }
  }
  return headlessFlag;
}

/** Forget the cached flag so the next read looks at session storage again (tests only). */
export function resetHeadlessFlagForTests(): void {
  headlessFlag = undefined;
}

/**
 * Who approvals for this agent reach, and whether it counts as headless. The gateway's owner hint
 * is used only when its own `welcome` classified this connection as headless and the owner is a
 * real user here; otherwise the connected user owns the call as before. A routing hint only: it
 * grants nothing. Either source makes the agent headless, and neither can clear it.
 */
function agentFor(
  client: LinkClient,
  user: OpUser,
  agentId: string,
  userExists: (id: string) => boolean,
): OpCall['agent'] {
  const hinted = client.headlessOwnerUserId;
  return {
    id: agentId,
    ownerUserId: hinted !== null && userExists(hinted) ? hinted : user.id,
    headless: client.headlessByGateway || linkAgentHeadless(),
  };
}

/**
 * Run inbound link calls through the dispatcher as the local Foundry user. Identity comes only
 * from `game.user`; nothing about who is calling is read from the call frame, which is why the
 * handler below touches only `tool`, `args` and `sessionId` of it.
 */
export function installBridge(client: LinkClient, deps: Partial<BridgeDeps> = {}): void {
  const { dispatch, getUser, storage, userExists } = { ...defaults, ...deps };
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
        agent: agentFor(client, user, client.agentId ?? '', userExists ?? (() => false)),
        sessionId: frame.sessionId,
      },
      user,
    );
    if (isOpError(res)) return { ok: false, code: res.error.code, message: res.error.message };
    return {
      ok: true,
      text: res.text,
      structured: res.structured,
      ...(res.images ? { images: res.images } : {}),
    };
  };
  client.onCall = handler;
  const guards = new Map<string, ReplayReceipts>();
  client.onQueued = async (frame, current, send) => {
    const u = getUser(),
      agentId = client.agentId;
    if (!u || typeof u.id !== 'string' || !u.id || !agentId || !current()) return;
    const user: OpUser = { id: u.id, isGM: u.isGM === true };
    const scope = client.replayScope();
    let receipts = guards.get(scope);
    if (!receipts) {
      receipts = new ReplayReceipts(storage(), `agent-gateway.replay.${scope}`);
      guards.set(scope, receipts);
    }
    const guard = receipts;
    if (Date.now() >= frame.expiresAt) {
      send('expired', 'Queued intent expired');
      return;
    }
    const claim = receipts.claim(frame.id, {
      user: user.id,
      agentId,
      tool: frame.tool,
      args: frame.args,
      sessionId: frame.sessionId,
      expiresAt: frame.expiresAt,
      definition: frame.definition,
    });
    if (!claim.fresh) {
      send(claim.receipt.status, claim.receipt.text, claim.receipt.resultFailed);
      return;
    }
    const report = (status: Parameters<typeof send>[0], text: string, resultFailed?: boolean) => {
      const saved = guard.update(frame.id, status, text, resultFailed);
      send(saved.status, saved.text, saved.resultFailed);
    };
    const def = liveToolMetadata.info(frame.tool);
    if (
      !def ||
      canonicalJson({
        name: def.name,
        category: def.category,
        minRole: def.minRole,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        ...(def.origin !== 'core'
          ? {
              pack: {
                id: def.origin.packId,
                version: def.origin.version,
                prefix: def.origin.prefix,
              },
            }
          : {}),
      }) !== canonicalJson(frame.definition)
    ) {
      report('denied', 'Canonical tool definition changed');
      return;
    }
    const call: OpCall = {
      tool: frame.tool,
      args: frame.args,
      sessionId: frame.sessionId,
      agent: agentFor(client, user, agentId, userExists ?? (() => false)),
    };
    let approvedGM = false;
    bindReplay(call, {
      markApproved: (gm) => {
        approvedGM = gm;
      },
      gmApproved: () => approvedGM,
      id: frame.id,
      expiresAt: frame.expiresAt,
      current: () =>
        current() &&
        getUser()?.id === user.id &&
        getUser()?.isGM === user.isGM &&
        client.agentId === agentId,
      report,
    });
    try {
      const res = await dispatch(call, user);
      if (isOpError(res)) report('denied', `${res.error.code}: ${res.error.message}`);
      else if (res.structured?.status === 'pending_approval')
        report('pending', 'Awaiting fresh once approval; nothing executed');
      else report('approved', res.text, false);
    } catch {
      report('unknown', 'Execution outcome unknown; reconciliation required');
    }
  };
}
