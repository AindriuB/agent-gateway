/* eslint-disable @typescript-eslint/no-explicit-any */
import { findAuditJournal } from './journal.js';
import { newEntryId } from './record.js';
import { AUDIT_NS, AUDIT_TYPE } from './types.js';

declare const game: any;
declare function getDocumentClass(name: string): any;

const FLAG = 'undoReservation';

export interface UndoReservation {
  /** A fresh server read made after acquiring the reservation, including completion state. */
  page: any;
  isHeld(): boolean;
  release(): Promise<void>;
}

export interface ReservationDeps {
  journal(): any;
  readPage(journal: any, id: string): Promise<any>;
  userId(): string;
  token(): string;
}

const defaultDeps: ReservationDeps = {
  journal: findAuditJournal,
  readPage: async (parent, id) => {
    const cls = getDocumentClass('JournalEntryPage');
    // fromUuid reads the client cache. A previous holder may have completed before this
    // client saw its update, so query the server while the reservation prevents another undo.
    const pages = await cls.database.get(cls, { parent, query: { _id: id } });
    // Embedded reads can return the whole collection despite query, and result documents
    // have no parent binding. Use them as authoritative data, never as update handles.
    return pages.find((page: any) => page.id === id) ?? null;
  },
  userId: () => String(game.user?.id ?? ''),
  token: newEntryId,
};

/** Deterministic 16-character Foundry id. A hash collision refuses undo; it never steals a lock. */
export function reservationId(uuid: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const c of `agent-gateway.audit.undo:${uuid}`) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Foundry serializes embedded creation and rejects a duplicate retained id. Reserve on the
 * server before any undo mutation, across GMs and tabs. No timeout steals a reservation: a
 * disconnected holder may still have a mutation in flight and requires human recovery.
 */
export async function reserveUndo(
  page: any,
  overrides: Partial<ReservationDeps> = {},
): Promise<UndoReservation | null> {
  const deps = { ...defaultDeps, ...overrides };
  const journal = deps.journal();
  if (
    !journal ||
    page?.parent !== journal ||
    page.type !== AUDIT_TYPE ||
    !page.uuid ||
    journal.pages?.get(page.id) !== page
  ) {
    throw new Error('undo requires an entry in the trusted audit journal');
  }
  const id = reservationId(page.uuid);
  const token = deps.token();
  const owns = (doc: any): boolean => {
    const held = doc?.flags?.[AUDIT_NS]?.[FLAG];
    return held?.entry === page.uuid && held?.token === token;
  };
  let lock: any;
  try {
    [lock] = await journal.createEmbeddedDocuments(
      'JournalEntryPage',
      [
        {
          _id: id,
          name: `Undo reservation: ${page.id}`,
          type: 'text',
          text: {
            content:
              '<p>An audit undo owns this reservation. Do not remove it while undo is running. If its client disconnected, inspect the audit entry and world documents before manually removing this page.</p>',
          },
          flags: { [AUDIT_NS]: { [FLAG]: { entry: page.uuid, token, userId: deps.userId() } } },
        },
      ],
      { keepId: true },
    );
  } catch (err) {
    // An uncertain response can also leave a server reservation. Never proceed or retry a
    // create under a different id, and never delete another client's reservation.
    console.warn('agent-gateway | undo reservation unavailable', err);
    return null;
  }
  if (lock?.id !== id || !owns(lock)) {
    if (owns(lock)) await lock.delete();
    throw new Error('the server did not retain the undo reservation id and token');
  }
  const isHeld = () => owns(journal.pages.get(id));
  const release = async () => {
    const current = journal.pages.get(id);
    if (owns(current)) await current.delete();
  };
  try {
    const fresh = await deps.readPage(journal, page.id);
    if (
      !fresh ||
      fresh.id !== page.id ||
      fresh.type !== AUDIT_TYPE ||
      fresh.system?.entryId !== page.system?.entryId
    ) {
      throw new Error('the reserved audit entry no longer matches');
    }
    return { page: fresh, isHeld, release };
  } catch (err) {
    await release();
    throw err;
  }
}
