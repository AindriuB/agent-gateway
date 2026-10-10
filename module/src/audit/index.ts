/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAuditAppClass } from '../apps/audit/index.js';
import { createAuditModel } from './model.js';
import { AuditRelay } from './relay.js';
import { fromUuidCompat } from '../compat/index.js';
import { AuditWitness, installWitnessHooks } from './witness.js';
import { setAuditSink, setIntentRequester } from './sink.js';
import {
  ensureAuditJournal,
  findAuditJournal,
  registerAuditSettings,
  writeAuditEntry,
} from './journal.js';
import { AUDIT_NS, AUDIT_SOCKET, AUDIT_TYPE } from './types.js';

export { auditStage, createAuditStage, AUDIT_STAGE_ORDER } from './stage.js';
export { AUDIT_TYPE } from './types.js';

declare const game: any;
declare const CONFIG: any;
declare const foundry: any;
declare const Hooks: any;

/** How long a GM client waits for trailing document hooks before it assembles a relayed record. */
const GRACE_MS = 1500;

let installed = false;
let relay: AuditRelay | null = null;

export function getAuditRelay(): AuditRelay | null {
  return relay;
}

function initAudit(): void {
  // Outside Foundry (unit tests that import main) there is nothing to register.
  if (typeof CONFIG === 'undefined' || !foundry?.abstract?.TypeDataModel) return;
  registerAuditSettings();
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
  const witness = new AuditWitness({
    fromUuid: (uuid) => fromUuidCompat(uuid),
    now: () => Date.now(),
    grace: () => new Promise((res) => setTimeout(res, GRACE_MS)),
    every: (fn, ms) => {
      const h = setInterval(fn, ms);
      return () => clearInterval(h);
    },
  });
  relay = new AuditRelay({
    selfId: self,
    isGM: () => game.user.isGM === true,
    activeGMId: () => game.users.activeGM?.id ?? null,
    isUserGM: (id) => game.users.get(id)?.isGM === true,
    emit: (msg, recipients) => game.socket.emit(AUDIT_SOCKET, msg, { recipients }),
    // Relayed records are written as view-only (sanitiseRecord and pageData both enforce it).
    write: async (record, senderId) => {
      const final = record.relayed ? await witness.assemble(record, senderId) : record;
      await writeAuditEntry(final);
    },
    onIntent: (msg, senderId) => witness.onIntent(msg, senderId),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    now: () => Date.now(),
  });
  witness.start();
  const g = globalThis as { addEventListener?: (t: string, f: () => void) => void };
  g.addEventListener?.('pagehide', () => witness.stop());
  const r = relay;
  setIntentRequester((callId, what) => r.requestIntent(callId, what));
  installWitnessHooks(
    Hooks,
    witness,
    () => game.user.isGM === true && game.users.activeGM?.id === game.user.id,
  );
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
