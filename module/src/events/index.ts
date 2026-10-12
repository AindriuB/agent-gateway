/* eslint-disable @typescript-eslint/no-explicit-any */
import { AgentEvent, EVENT_CONFIG, type LinkMessage } from '@agent-gateway/protocol/link';
import { isAuditDocument } from '../audit/guard.js';

interface Client {
  state: { kind: string };
  onState(fn: (state: { kind: string }) => void): () => void;
  sendMessage(message: LinkMessage): void;
}
interface HooksApi {
  on(name: string, callback: (...args: any[]) => void): unknown;
  off(name: string, id: unknown): void;
}
export interface EventTapDeps {
  hooks: HooksApi;
  user(): any;
  canvas(): any;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}
type Draft = Pick<AgentEvent, 'type' | 'summary' | 'doc' | 'agent_action'>;
type Pending = {
  doc: any;
  type: AgentEvent['type'];
  agent: boolean;
  user: any;
  epoch: number;
  timer: unknown;
};
const installed = new WeakMap<Client, { dispose(): void }>();
const bounded = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max).replace(/[\u0000-\u001f\u007f]/g, ' ') : '';

/** Observes this client's native view only; no retention, document serialization or world writes. */
export function installEventTap(client: Client, overrides?: EventTapDeps): { dispose(): void } {
  const existing = installed.get(client);
  if (existing) return existing;
  const g = globalThis as any;
  const deps: EventTapDeps = overrides ?? {
    hooks: g.Hooks,
    user: () => (g.game?.users?.get(g.game?.user?.id) === g.game?.user ? g.game?.user : undefined),
    canvas: () => g.canvas,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let live = client.state.kind === 'connected',
    epoch = live ? 1 : 0,
    seq = 0,
    disposed = false,
    connectionUser = live ? deps.user() : undefined;
  const pending = new Map<string, Pending>(),
    hooks: Array<[string, unknown]> = [];
  const clear = () => {
    for (const item of pending.values()) deps.clearTimer(item.timer);
    pending.clear();
  };
  const unsubscribe = client.onState((state) => {
    if (state.kind === 'connected') {
      if (!live) {
        epoch++;
        seq = 0;
        live = true;
        connectionUser = deps.user();
      }
    } else {
      live = false;
      connectionUser = undefined;
      epoch++;
      clear();
    }
  });
  const visible = (doc: any, user: any): boolean => {
    if (!doc || !user || isAuditDocument(doc)) return false;
    if (doc.documentName === 'ChatMessage') return doc.isContentVisible === true;
    if (doc.documentName === 'Combat') return doc.visible === true;
    if (doc.documentName === 'Token') {
      const canvas = deps.canvas(),
        object = doc._object;
      return (
        !!canvas?.ready &&
        canvas.scene === doc.parent &&
        (!doc.hidden || user.isGM === true) &&
        !!object &&
        object.destroyed === false &&
        object.document === doc &&
        object.isVisible === true
      );
    }
    const seen = new Set<any>();
    for (let current = doc; current; current = current.parent) {
      if (
        seen.size === 8 ||
        seen.has(current) ||
        current.testUserPermission?.(user, 'OBSERVER') !== true
      )
        return false;
      seen.add(current);
    }
    return true;
  };
  const emit = (draft: Draft, user = deps.user()) => {
    if (
      disposed ||
      !live ||
      client.state.kind !== 'connected' ||
      !user ||
      user !== connectionUser ||
      deps.user() !== user ||
      seq === Number.MAX_SAFE_INTEGER
    )
      return;
    const parsed = AgentEvent.safeParse({
      ...draft,
      seq: seq + 1,
      ts: deps.now(),
      userId: user.id,
    });
    if (!parsed.success) return;
    seq++;
    try {
      client.sendMessage({ type: 'event', event: parsed.data });
    } catch {
      /* A failed send is never retried into a different connection. */
    }
  };
  const ref = (doc: any, user: any): NonNullable<AgentEvent['doc']> => ({
    uuid: bounded(doc.uuid, 2048),
    type: bounded(doc.documentName, 100),
    name: bounded(
      doc.documentName === 'ChatMessage'
        ? 'Chat message'
        : doc.documentName === 'Combat'
          ? 'Combat'
          : doc.documentName === 'Scene' && !user.isGM
            ? doc.navName || doc.name
            : doc.name,
      200,
    ),
  });
  const documentEvent = (doc: any, type: AgentEvent['type'], agent: boolean, user: any) => {
    if (!visible(doc, user)) return;
    emit(
      {
        type,
        doc: ref(doc, user),
        summary: `${doc.documentName} ${type.endsWith('_create') ? 'created' : type.endsWith('_delete') ? 'deleted' : type.endsWith('_update') ? 'updated' : 'event'}`,
        ...(agent ? { agent_action: true } : {}),
      },
      user,
    );
  };
  const on = (name: string, fn: (...args: any[]) => void) => {
    hooks.push([
      name,
      deps.hooks.on(name, (...args: any[]) => {
        try {
          if (live && !disposed) fn(...args);
        } catch {
          /* Missing or throwing native visibility/data fails closed. */
        }
      }),
    ]);
  };
  const agent = (options: any) =>
    typeof options?.agentGateway?.callId === 'string' &&
    options.agentGateway.callId.length > 0 &&
    options.agentGateway.callId.length <= 100;
  for (const [type, prefix] of [
    ['Actor', 'actor'],
    ['Item', 'item'],
    ['JournalEntry', 'journal'],
    ['Scene', 'scene'],
    ['Token', 'token'],
  ] as const) {
    on(`create${type}`, (doc, options) =>
      documentEvent(doc, `${prefix}_create`, agent(options), deps.user()),
    );
    on(`update${type}`, (doc, _change, options) => {
      const user = deps.user();
      if (!visible(doc, user)) return;
      const id = bounded(doc.uuid, 2048);
      if (!id) return;
      const previous = pending.get(id);
      if (previous) {
        previous.doc = doc;
        previous.agent ||= agent(options);
        previous.user = user;
        return;
      }
      if (pending.size >= EVENT_CONFIG.MAX_PENDING_UPDATES) return;
      const item: Pending = {
        doc,
        type: `${prefix}_update`,
        agent: agent(options),
        user,
        epoch,
        timer: undefined,
      };
      pending.set(id, item);
      item.timer = deps.setTimer(() => {
        if (pending.get(id) !== item) return;
        pending.delete(id);
        try {
          if (live && item.epoch === epoch && deps.user() === item.user)
            documentEvent(item.doc, item.type, item.agent, item.user);
        } catch {
          /* Recheck native visibility at flush. */
        }
      }, EVENT_CONFIG.COALESCE_MS);
    });
    on(`delete${type}`, (doc, options) => {
      const id = bounded(doc.uuid, 2048),
        item = pending.get(id);
      if (item) {
        deps.clearTimer(item.timer);
        pending.delete(id);
      }
      documentEvent(doc, `${prefix}_delete`, agent(options), deps.user());
    });
  }
  on('createChatMessage', (doc, options) => {
    if (visible(doc, deps.user()))
      emit({
        type: doc.isRoll === true ? 'roll' : 'chat',
        doc: ref(doc, deps.user()),
        summary: doc.isRoll === true ? 'A roll was posted' : 'A chat message was posted',
        ...(agent(options) ? { agent_action: true } : {}),
      });
  });
  for (const [hook, type] of [
    ['combatStart', 'combat_start'],
    ['combatTurn', 'combat_turn'],
    ['combatRound', 'combat_round'],
    ['deleteCombat', 'combat_end'],
  ] as const)
    on(hook, (doc, _data, options) =>
      documentEvent(
        doc,
        type,
        hook === 'deleteCombat' ? agent(_data) : agent(options),
        deps.user(),
      ),
    );
  on('userConnected', (user, active) => {
    if (typeof user?.id === 'string' && typeof active === 'boolean')
      emit({
        type: active ? 'user_join' : 'user_leave',
        summary: active ? 'A user connected' : 'A user disconnected',
      });
  });
  on('canvasReady', (canvas) => {
    if (canvas === deps.canvas() && canvas.ready && visible(canvas.scene, deps.user()))
      emit({
        type: 'scene_change',
        doc: ref(canvas.scene, deps.user()),
        summary: 'The viewed scene changed',
      });
  });
  on('agentGateway.approvalRequested', () =>
    emit({ type: 'approval_requested', summary: 'An approval was requested' }),
  );
  on('agentGateway.approvalResolved', () =>
    emit({ type: 'approval_resolved', summary: 'An approval was resolved' }),
  );
  const handle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      live = false;
      clear();
      unsubscribe();
      for (const [name, id] of hooks) deps.hooks.off(name, id);
      installed.delete(client);
    },
  };
  installed.set(client, handle);
  return handle;
}
