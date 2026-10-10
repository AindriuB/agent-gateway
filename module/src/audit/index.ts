/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAuditAppClass } from '../apps/audit/index.js';
import { createAuditModel } from './model.js';
import { AuditRelay } from './relay.js';
import { setAuditSink } from './sink.js';
import {
  ensureAuditJournal,
  findAuditJournal,
  verifyRelayedTargets,
  writeAuditEntry,
} from './journal.js';
import { AUDIT_NS, AUDIT_SOCKET, AUDIT_TYPE } from './types.js';

export { auditStage, createAuditStage, AUDIT_STAGE_ORDER } from './stage.js';
export { AUDIT_TYPE } from './types.js';

declare const game: any;
declare const CONFIG: any;
declare const foundry: any;
declare const Hooks: any;

let installed = false;
let relay: AuditRelay | null = null;

export function getAuditRelay(): AuditRelay | null {
  return relay;
}

function initAudit(): void {
  // Outside Foundry (unit tests that import main) there is nothing to register.
  if (typeof CONFIG === 'undefined' || !foundry?.abstract?.TypeDataModel) return;
  CONFIG.JournalEntryPage.dataModels[AUDIT_TYPE] = createAuditModel();
  CONFIG.JournalEntryPage.typeLabels[AUDIT_TYPE] = 'AGENT_GATEWAY.Audit.typeLabel';
  game.settings.registerMenu(AUDIT_NS, 'audit', {
    name: 'AGENT_GATEWAY.Audit.menu.name',
    label: 'AGENT_GATEWAY.Audit.menu.label',
    hint: 'AGENT_GATEWAY.Audit.menu.hint',
    icon: 'fa-solid fa-clipboard-list',
    type: getAuditAppClass(),
    restricted: true,
  });
}

function readyAudit(): void {
  const user = game?.user;
  if (!user || !game.socket) return;
  const self = () => String(game.user.id);
  relay = new AuditRelay({
    selfId: self,
    isGM: () => game.user.isGM === true,
    activeGMId: () => game.users.activeGM?.id ?? null,
    isUserGM: (id) => game.users.get(id)?.isGM === true,
    emit: (msg) => game.socket.emit(AUDIT_SOCKET, msg),
    write: async (record, senderId) => {
      if (record.relayed) {
        const sender = game.users.get(senderId);
        if (!sender) throw new Error('unknown sender');
        await writeAuditEntry(await verifyRelayedTargets(record, sender));
      } else await writeAuditEntry(record);
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  });
  const r = relay;
  setAuditSink((record) => r.submit(record));
  game.socket.on(AUDIT_SOCKET, (data: unknown, senderId: unknown) => {
    void r.onMessage(data, senderId);
  });
  Hooks.on('userConnected', () => r.onPresenceChange());
  // One GM creates the journal; the designated GM avoids two creating it at once.
  if (user.isGM === true && game.users.activeGM?.id === user.id && !findAuditJournal()) {
    void ensureAuditJournal().catch((err) =>
      console.error('agent-gateway | could not create the audit journal', err),
    );
  }
}

/** Register the audit subtype, menu and socket relay with Foundry's hooks. Idempotent. */
export function installAudit(): void {
  if (installed || typeof Hooks === 'undefined') return;
  installed = true;
  Hooks.once('init', initAudit);
  Hooks.once('ready', readyAudit);
}
