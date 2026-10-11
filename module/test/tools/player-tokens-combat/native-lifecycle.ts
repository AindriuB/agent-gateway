/** Retain every observed exact-call audit even when the bounded drain eventually fails. */
export function retainNativeAudit(
  rows: readonly { key: string; uuid: string }[],
  expected: readonly string[],
  retained: string[],
) {
  for (const row of rows)
    if (expected.includes(row.key) && !retained.includes(row.uuid)) retained.push(row.uuid);
}

/** Native Combat deletion may activate the viewed combat; restore personal state afterwards. */
export async function cleanupNativeFixtures(steps: {
  hasFixtureCombat?: boolean;
  clearViewed: () => Promise<void>;
  deleteFixtures: () => Promise<void>;
  restoreViews: () => Promise<void>;
}) {
  if (steps.hasFixtureCombat !== false) await steps.clearViewed();
  try {
    await steps.deleteFixtures();
  } finally {
    await steps.restoreViews();
  }
}
