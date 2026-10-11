/* eslint-disable @typescript-eslint/no-explicit-any */
/** Test-only passive raw transport observer; this function is also serialized into the native browser. */
export function observeNativeAuditProgress(
  target: { journalUuid: string; pageId: string; gmId: string; roots: string[] },
  socket: any = (globalThis as any).SocketInterface,
) {
  const bounded = (value: unknown, max = 1024): value is string =>
    typeof value === 'string' && value.length > 0 && value.length <= max;
  if (
    !bounded(target.journalUuid) ||
    !bounded(target.pageId, 100) ||
    !bounded(target.gmId, 100) ||
    target.roots.length !== 3 ||
    new Set(target.roots).size !== 3 ||
    target.roots.some((id) => !bounded(id))
  )
    throw Error('Invalid exact raw observer target');
  const original = socket.dispatch;
  const events: any[] = [];
  let active = true;
  let updates = 0;
  let failed = false;
  let observed = false;
  let lastRead = '';
  const pending = new Set<Promise<unknown>>();
  let latest: any;
  let reservationCount: number | null = null;
  const copy = (doc: any) => {
    const system = { ...(doc?.system ?? {}) };
    for (const key of ['undoCompleted', 'undoneBy', 'undoneAt'])
      if (Object.hasOwn(doc, `system.${key}`)) system[key] = doc[`system.${key}`];
    if (
      (Array.isArray(system.undoCompleted) &&
        (system.undoCompleted.length > 3 ||
          system.undoCompleted.some(
            (id: unknown) => typeof id === 'string' && id.length > 1024,
          ))) ||
      (typeof system.undoneBy === 'string' && system.undoneBy.length > 100)
    )
      throw Error('Raw progress bound exceeded');
    return {
      undoCompleted:
        Array.isArray(system?.undoCompleted) && system.undoCompleted.length <= 3
          ? system.undoCompleted.map((id: unknown) => (bounded(id) ? id : null))
          : null,
      undoneBy: bounded(system?.undoneBy, 100) ? system.undoneBy : null,
      undoneAt:
        typeof system?.undoneAt === 'number' && Number.isFinite(system.undoneAt)
          ? system.undoneAt
          : null,
    };
  };
  const extract = (response: any) => {
    const responses = Array.isArray(response?.results) ? response.results : [response];
    if (responses.length > 32) throw Error('Raw response bound exceeded');
    const matches: any[] = [];
    for (const row of responses) {
      if (row?.type !== 'JournalEntryPage' || row?.operation?.parentUuid !== target.journalUuid)
        continue;
      if (!Array.isArray(row.result) || row.result.length > 100)
        throw Error('Raw row bound exceeded');
      const exact = row.result.filter((doc: any) => doc?._id === target.pageId);
      matches.push(...exact);
    }
    if (matches.length > 1) throw Error('Ambiguous exact raw audit');
    return matches.length === 1 ? copy(matches[0]) : null;
  };
  const record = (kind: string, progress: any) => {
    if (!active) return;
    if (kind.endsWith('error')) failed = true;
    if (kind === 'get') {
      const key = JSON.stringify({ progress, reservationCount });
      if (key === lastRead) return;
      lastRead = key;
    }
    if (events.length >= 256) {
      failed = true;
      return;
    }
    events.push({ kind, progress });
  };
  const read = async () => {
    if (!active) throw Error('Raw observer stopped');
    latest = undefined;
    reservationCount = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        original.call(socket, 'modifyDocument', {
          type: 'JournalEntryPage',
          action: 'get',
          operation: { parentUuid: target.journalUuid, query: { _id: target.pageId } },
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Raw audit read timeout')), 5000);
        }),
      ]);
      const progress = extract(response);
      clearTimeout(timer);
      const reservation = await Promise.race([
        original.call(socket, 'modifyDocument', {
          type: 'JournalEntryPage',
          action: 'get',
          operation: {
            parentUuid: target.journalUuid,
            query: {
              'flags.agent-gateway.undoReservation.entry': `${target.journalUuid}.JournalEntryPage.${target.pageId}`,
            },
          },
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Raw reservation read timeout')), 5000);
        }),
      ]);
      if (
        reservation?.type !== 'JournalEntryPage' ||
        reservation.operation?.parentUuid !== target.journalUuid ||
        !Array.isArray(reservation.result) ||
        reservation.result.length > 100
      )
        throw Error('Malformed raw reservation response');
      const count = reservation.result.filter(
        (row: any) =>
          row?.flags?.['agent-gateway']?.undoReservation?.entry ===
          `${target.journalUuid}.JournalEntryPage.${target.pageId}`,
      ).length;
      if (active) {
        latest = progress;
        reservationCount = count;
      }
      record('get', progress);
      return progress;
    } catch (error) {
      record('get-error', null);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const wrapper = function (this: any, ...args: any[]) {
    const result = original.apply(this, args);
    try {
      const request = args[1];
      const exact =
        active &&
        args[0] === 'modifyDocument' &&
        request?.type === 'JournalEntryPage' &&
        request.action === 'update' &&
        request.operation?.parentUuid === target.journalUuid &&
        Array.isArray(request.operation.updates) &&
        request.operation.updates.length <= 100 &&
        request.operation.updates.some((row: any) => row?._id === target.pageId);
      if (exact) {
        if (++updates > 64) {
          record('bound-error', null);
          return result;
        }
        if (!result || typeof result.then !== 'function') {
          record('observation-error', null);
          return result;
        }
        // Attach before native model construction, but return the caller's original promise.
        const observation = result.then(
          async (response: any) => {
            const progress = extract(response);
            if (progress === null) record('observation-error', null);
            if (
              progress &&
              (progress.undoCompleted !== null ||
                progress.undoneBy !== null ||
                progress.undoneAt !== null)
            )
              observed = true;
            record('update', progress);
            if (active) await read();
          },
          () => record('update-error', null),
        );
        const safe = observation
          .catch(() => record('observation-error', null))
          .finally(() => pending.delete(safe));
        pending.add(safe);
      }
    } catch {
      record('observation-error', null);
    }
    return result;
  };
  socket.dispatch = wrapper;
  const drain = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...pending]),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Raw observation drain timeout')), 11000);
        }),
      ]);
    } catch (error) {
      record('drain-error', null);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
  const snapshot = () => ({
    events: [...events],
    latest,
    reservationCount,
    failed,
    observed,
    pending: pending.size,
  });
  const complete = () =>
    !failed &&
    observed &&
    pending.size === 0 &&
    reservationCount === 0 &&
    latest &&
    latest.undoneBy === target.gmId &&
    Number.isFinite(latest.undoneAt) &&
    latest.undoneAt > 0 &&
    Array.isArray(latest.undoCompleted) &&
    latest.undoCompleted.length === 3 &&
    new Set(latest.undoCompleted).size === 3 &&
    target.roots.length === 3 &&
    JSON.stringify([...latest.undoCompleted].sort()) === JSON.stringify([...target.roots].sort());
  const observer = {
    read,
    drain,
    snapshot,
    complete,
    stop() {
      active = false;
      if (socket.dispatch === wrapper) socket.dispatch = original;
    },
  };
  (globalThis as any).__task23AuditProgress = observer;
  return observer;
}
