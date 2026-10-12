/* eslint-disable @typescript-eslint/no-explicit-any */
/** Read-only bootstrap: register deserializers only; no ready hooks, manager, audit sink or policy migration. */
import { createAuditModel } from '../../../src/audit/model.js';
declare const Hooks: any, game: any, CONFIG: any;
Hooks.once('init', () => {
  game.settings.register('agent-gateway', 'auditJournalId', {
    scope: 'world',
    config: false,
    type: String,
    default: '',
  });
  game.settings.register('agent-gateway', 'ownerPolicy', {
    scope: 'client',
    config: false,
    type: String,
    default: '{}',
  });
  CONFIG.JournalEntryPage.dataModels['agent-gateway.audit'] = createAuditModel();
});
