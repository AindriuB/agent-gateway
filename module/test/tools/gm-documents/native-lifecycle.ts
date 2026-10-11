/* eslint-disable @typescript-eslint/no-explicit-any */
/** Runs in the native browser: recover only this nonce or exact correlated create targets. */
export async function discoverNativeFixtures(input: { prefix: string; retained: string[] }) {
  const g = globalThis as any;
  const uuids = new Set<string>();
  for (const collection of [g.game.actors, g.game.journal])
    for (const doc of collection.contents) {
      if (!doc.name?.startsWith(input.prefix)) continue;
      uuids.add(doc.uuid);
      for (const child of [...(doc.effects?.contents ?? []), ...(doc.pages?.contents ?? [])])
        if (child.name?.startsWith(input.prefix)) uuids.add(child.uuid);
    }
  for (const uuid of input.retained) {
    const page = await g.fromUuid(uuid);
    const system = page?.system;
    if (!system || !['document_create', 'compendium_import'].includes(system.tool)) continue;
    const args = JSON.parse(system.args);
    for (const target of system.targets) {
      if (target.existed !== false) continue;
      const doc = await g.fromUuid(target.uuid);
      if (!doc) continue;
      if (system.tool === 'compendium_import') {
        if (
          args.uuid !== 'Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z' ||
          doc.documentName !== 'Item' ||
          doc.parent ||
          doc.name !== 'Dagger'
        )
          throw Error('Correlated import target mismatch');
      } else if (
        doc.documentName !== args.type ||
        !doc.name?.startsWith(input.prefix) ||
        (args.parentUuid && doc.parent?.uuid !== args.parentUuid)
      )
        throw Error('Correlated create target mismatch');
      uuids.add(doc.uuid);
    }
  }
  return [...uuids];
}
/** A failed UI wait must never turn into a long implicit wait followed by racing cleanup. */
export async function prepareNativeCleanup(deps: {
  settle(): Promise<void>;
  drain(): Promise<void>;
  assertNoReservation(): Promise<void>;
  invalidatePending(): Promise<void>;
  discover(): Promise<void>;
  remove(): Promise<void>;
  baselineCaptured?: boolean;
  settleTimeoutMs?: number;
}) {
  if (deps.baselineCaptured === false) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      deps.settle(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Error(
                'Native calls not terminal: preserve GM and request human reconciliation before cleanup',
              ),
            ),
          deps.settleTimeoutMs ?? 15000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  await deps.drain();
  await deps.assertNoReservation();
  await deps.invalidatePending();
  await deps.discover();
  await deps.remove();
}
