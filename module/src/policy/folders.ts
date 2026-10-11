/* eslint-disable @typescript-eslint/no-explicit-any */
import { readWorldSnapshot, type AdmittedSnapshot } from './snapshot.js';

/**
 * May the agent see this world document, given the GM's folder allowlist for its class? An empty
 * list means no restriction; otherwise the document's folder, or one of that folder's ancestors,
 * must be listed. A document outside is treated like a missing one by the read tools, so the
 * allowlist never reveals what is excluded. Apply it to the top-level world document: embedded
 * documents follow their root.
 */
export function folderAllowed(
  doc: any,
  isGM: boolean,
  snapshot: AdmittedSnapshot = readWorldSnapshot(),
): boolean {
  const allowed = snapshot.folders[isGM ? 'gmAgents' : 'playerAgents'];
  if (allowed.length === 0) return true;
  const seen = new Set<unknown>();
  for (let f = doc?.folder; f && !seen.has(f) && seen.size < 100; f = f.folder) {
    seen.add(f);
    if (allowed.includes(String(f.id))) return true;
  }
  return false;
}
