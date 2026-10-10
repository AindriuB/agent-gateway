/* eslint-disable @typescript-eslint/no-explicit-any */
import { getApplicationV2, getHandlebarsApplicationMixin } from '../../compat/index.js';
import { findAuditJournal } from '../../audit/journal.js';
import { undoEntry, type Conflict, type UndoOutcome } from '../../audit/undo.js';
import { SHOWN_ENTRIES, entryView } from './view.js';

declare const game: any;
declare const ui: any;
declare const foundry: any;
declare const Hooks: any;

const NS = 'agent-gateway';

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The conflict warning: every changed document, then Yes / No. HTML-escaped; uuids are data. */
export async function confirmConflicts(conflicts: Conflict[]): Promise<boolean> {
  const i18n = game.i18n;
  const items = conflicts
    .map(
      (c) =>
        `<li>${escapeHtml(c.uuid)}: ${escapeHtml(i18n.localize(`AGENT_GATEWAY.Audit.conflict.${c.reason}`))}</li>`,
    )
    .join('');
  const result = await foundry.applications.api.DialogV2.confirm({
    window: { title: i18n.localize('AGENT_GATEWAY.Audit.conflict.title') },
    content: `<p>${escapeHtml(i18n.localize('AGENT_GATEWAY.Audit.conflict.body'))}</p><ul>${items}</ul>`,
    rejectClose: false,
  });
  return result === true;
}

export function notifyOutcome(o: UndoOutcome): void {
  const i18n = game.i18n;
  if (o.status === 'done') {
    ui.notifications.info(i18n.format('AGENT_GATEWAY.Audit.undoDone', { count: o.restored }));
    if (o.skipped.length) {
      ui.notifications.warn(
        i18n.format('AGENT_GATEWAY.Audit.undoSkipped', { count: o.skipped.length }),
      );
    }
  } else if (o.status === 'failed') {
    ui.notifications.error(
      i18n.format('AGENT_GATEWAY.Audit.undoFailed', { count: o.failed.length }),
    );
  } else if (o.status === 'refused' || o.status === 'busy') {
    ui.notifications.warn(i18n.localize('AGENT_GATEWAY.Audit.undoRefused'));
  }
}

/** The entries shown: pages of the trusted audit journal only, newest first. */
export function listEntries(): ReturnType<typeof entryView>[] {
  const journal = findAuditJournal();
  const pages: any[] = Array.from(journal?.pages?.contents ?? []);
  return pages
    .filter((p) => p.type === 'agent-gateway.audit')
    .sort((a, b) => Number(b.system?.timestamp ?? 0) - Number(a.system?.timestamp ?? 0))
    .slice(0, SHOWN_ENTRIES)
    .map(entryView);
}

/** Built lazily: the ApplicationV2 base class only exists once Foundry has initialised. */
export function createAuditApp(): any {
  const Base = getHandlebarsApplicationMixin()(getApplicationV2());

  class AuditApp extends Base {
    static DEFAULT_OPTIONS = {
      id: 'agent-gateway-audit',
      window: {
        title: 'AGENT_GATEWAY.Audit.title',
        icon: 'fa-solid fa-clipboard-list',
        resizable: true,
      },
      position: { width: 720, height: 600 },
      actions: { undo: AuditApp.onUndo },
    };
    static PARTS = {
      list: { template: `modules/${NS}/templates/audit/audit.hbs`, scrollable: [''] },
    };

    private hookIds: Array<[string, number]> = [];

    async _prepareContext(): Promise<object> {
      const entries = listEntries();
      return { entries, empty: entries.length === 0 };
    }

    async _onRender(context: object, options: object): Promise<void> {
      await super._onRender?.(context, options);
      if (this.hookIds.length) return;
      const refresh = (page: any) => {
        if (page?.parent && page.parent === findAuditJournal()) void this.render();
      };
      for (const hook of [
        'createJournalEntryPage',
        'updateJournalEntryPage',
        'deleteJournalEntryPage',
      ]) {
        this.hookIds.push([hook, Hooks.on(hook, refresh)]);
      }
    }

    async _onClose(options: object): Promise<void> {
      for (const [hook, id] of this.hookIds) Hooks.off(hook, id);
      this.hookIds = [];
      await super._onClose?.(options);
    }

    static async onUndo(this: any, _event: Event, target: HTMLElement): Promise<void> {
      const id = target?.dataset?.pageId;
      const page = findAuditJournal()?.pages?.get?.(id);
      if (!page) return;
      notifyOutcome(await undoEntry(page, confirmConflicts));
    }
  }
  return AuditApp;
}

let appClass: any = null;

/** The one AuditApp class, built on first use. */
export function getAuditAppClass(): any {
  appClass ??= createAuditApp();
  return appClass;
}
