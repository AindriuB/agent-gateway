/* eslint-disable @typescript-eslint/no-explicit-any */
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
    rerun: async (call, user) => (await import('../ops/dispatch.js')).dispatch(call, user),
    random: (n) => globalThis.crypto.getRandomValues(new Uint8Array(n)),
    t: (key, data = {}) =>
      typeof game?.i18n?.format === 'function' ? String(game.i18n.format(key, data)) : key,
  };
}

let manager: ApprovalManager | undefined;

export function getApprovalManager(): ApprovalManager {
  return (manager ??= new ApprovalManager(liveEnv()));
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
  let wasConnected = false;
  getLinkClient().onState?.((s) => {
    const now = s.kind === 'connected';
    if (now && !wasConnected) m.representAll();
    wasConnected = now;
  });
  const mod = game.modules?.get(NS);
  if (mod) {
    mod.api = {
      ...(mod.api ?? {}),
      resolveApproval: (id: string, o: any) => m.resolveApproval(id, o),
      listApprovals: () => m.listPending(),
    };
  }
  m.representAll();
}

// The module entry point (main.ts) is not part of this task, so the approval queue wires its own
// ready step when this file is first imported, which the operation stages do.
if (typeof Hooks !== 'undefined' && typeof Hooks.once === 'function') {
  Hooks.once('ready', startApprovals);
}
