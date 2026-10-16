/* eslint-disable @typescript-eslint/no-explicit-any */
import { evaluate } from '../policy/evaluate.js';
import { CATEGORIES, type Category } from '../policy/matrix.js';
import { liveInputs } from '../policy/stage.js';
import { getLinkClient } from '../link/runtime.js';
import { APPROVAL_CHANNEL } from './config.js';
import { ApprovalManager } from './manager.js';
import type { ApprovalEnv, EnvUser } from './types.js';

declare const game: any;
declare const Hooks: any;

const NS = 'agent-gateway';
/** Client storage, as Foundry's own client settings use: per browser, per world. */
const storageKey = () => `${NS}.${String(game.world?.id ?? '')}.approvalQueue`;

const toUser = (u: any): EnvUser | undefined =>
  u && typeof u.id === 'string'
    ? { id: u.id, name: String(u.name ?? ''), isGM: u.isGM === true, active: u.active === true }
    : undefined;

export function liveEnv(): ApprovalEnv {
  return {
    currentDecision: (f) => {
      const u = toUser(game.users?.get(f.requesterId));
      if (!u || !(CATEGORIES as readonly string[]).includes(f.category)) return { kind: 'deny' };
      const v = evaluate(liveInputs(), {
        isGM: u.isGM,
        headless: f.headless,
        category: f.category as Category,
      });
      if (v.kind === 'disabled' || v.decision === 'deny') return { kind: 'deny' };
      return v.decision === 'allow'
        ? { kind: 'allow' }
        : { kind: 'ask', approver: v.decision === 'ask_gm' ? 'gm' : 'owner' };
    },
    localUser: () => toUser(game.user),
    user: (id) => toUser(game.users?.get(id)),
    users: () => [...(game.users?.contents ?? [])].map(toUser).filter((u): u is EnvUser => !!u),
    emit: (data, recipients) =>
      recipients
        ? game.socket.emit(APPROVAL_CHANNEL, data, { recipients })
        : game.socket.emit(APPROVAL_CHANNEL, data),
    callHook: (name, payload) => Hooks.callAll(name, payload),
    load: () => {
      try {
        return globalThis.localStorage?.getItem(storageKey()) ?? '';
      } catch {
        return '';
      }
    },
    save: (text) => globalThis.localStorage?.setItem(storageKey(), text),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    random: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
    t: (key, data = {}) =>
      typeof game?.i18n?.format === 'function' ? String(game.i18n.format(key, data)) : key,
  };
}

let manager: ApprovalManager | undefined;

export function getApprovalManager(): ApprovalManager {
  return (manager ??= new ApprovalManager(liveEnv()));
}

/** How long to wait for the gateway's ownership reply before withdrawing every mirrored record. */
export const OWNERSHIP_WAIT_MS = 10_000;

/** The parts of the link client the approval wiring uses. */
export interface ApprovalLink {
  onState?(fn: (s: { kind: string; reason?: string }) => void): unknown;
  sendApprovalState?(
    msg: { id: string; state: 'pending' | 'approved' | 'denied' | 'expired' } | { ids: string[] },
  ): boolean | void;
  onApprovalOwnership?(fn: (ids: string[], unknown: string[]) => void): unknown;
}

/**
 * Tie the approval queue to the gateway link (task 112). Transitions are mirrored to the gateway.
 * An answer given while the link is down is held until it is back. After each connect the pending
 * list is sent and nothing is released or re-presented until the gateway confirms which of those
 * approvals this connection owns; with no reply, or on takeover, they are withdrawn here and the
 * gateway asks again where the user is connected.
 */
export function wireApprovalLink(
  m: ApprovalManager,
  link: ApprovalLink,
  notify: (text: string) => void = (text) => (globalThis as any).ui?.notifications?.warn?.(text),
): void {
  const moved = () =>
    notify(
      "Agent Gateway: this tab's link was closed, so its pending approvals here were cancelled. Requests the gateway stored will be asked again where you are connected.",
    );
  m.onApprovalState((msg) => void link.sendApprovalState?.(msg));
  let wasConnected = false;
  let everConnected = false;
  // Approvals given while the link is down wait for it: the gateway must hear of them first.
  m.holdWhile(() => everConnected && !wasConnected);
  link.onApprovalOwnership?.((ids, unknown) => m.confirmOwnership(ids, unknown));
  link.onState?.((s) => {
    const now = s.kind === 'connected';
    if (s.kind === 'disconnected' && s.reason === 'REPLACED' && m.withdrawPending() > 0) moved();
    if (now && !wasConnected) {
      everConnected = true;
      wasConnected = true;
      const ids = m.pendingApprovalIds();
      const sent = link.sendApprovalState?.({ ids });
      if (sent) m.expectOwnership(OWNERSHIP_WAIT_MS, moved, ids);
      else {
        // A gateway that cannot mirror never replies: behave as before it existed.
        m.representAll();
        m.releaseHeld();
      }
    }
    if (!now && wasConnected) m.linkDropped();
    wasConnected = now;
  });
}

/** Start the socket relay once the world is ready. */
export function startApprovals(): void {
  const m = getApprovalManager();
  m.load();
  game.socket?.on?.(APPROVAL_CHANNEL, (data: unknown, senderId: unknown) =>
    m.handleSocket(data, senderId),
  );
  Hooks.on?.('userConnected', (user: any, connected: boolean) => {
    if (connected && typeof user?.id === 'string') m.representTo(user.id);
  });
  wireApprovalLink(m, getLinkClient());
  m.representAll();
}

// The module entry point (main.ts) is not part of this task, so the approval queue wires its own
// ready step when this file is first imported, which the operation stages do.
if (typeof Hooks !== 'undefined' && typeof Hooks.once === 'function') {
  Hooks.once('ready', startApprovals);
}
