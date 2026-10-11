import { AGENT_CLASSES, CATEGORIES, validateMatrix } from '../../../src/policy/matrix.js';
import { validateSnapshot } from '../../../src/policy/snapshot.js';

/** Pure native preflight parser; importing this never starts browsers or fixture writes. */
export function readNativeWritePolicy(raw: unknown): { gm: string; player: string } {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid native world policy');
  const root = value as Record<string, unknown>;
  let matrix;
  if (Object.hasOwn(root, 'version')) matrix = validateSnapshot(root).world;
  else {
    if (
      Object.keys(root).length !== AGENT_CLASSES.length ||
      AGENT_CLASSES.some((cls) => !Object.hasOwn(root, cls))
    )
      throw Error('Invalid legacy native world policy');
    for (const cls of AGENT_CLASSES) {
      const row = root[cls];
      if (
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).length !== CATEGORIES.length ||
        CATEGORIES.some((category) => !Object.hasOwn(row, category))
      )
        throw Error('Invalid legacy native world policy');
    }
    matrix = validateMatrix(root);
  }
  return { gm: matrix.gmAgents.write, player: matrix.playerAgents.write };
}
