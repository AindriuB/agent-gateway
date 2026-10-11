/** Test-only entry: bundled by live-proof.mts, never imported by production main. */
import { fixtures } from './live-definitions.js';
import { toolRegistry } from '../../../src/ops/registry.js';
import { coreEntry } from '../../../src/ops/core-tools.js';
import { setAuditSink } from '../../../src/audit/sink.js';

declare const Hooks: { once(hook: string, callback: () => void): void };

Hooks.once('init', () => {
  for (const tool of fixtures) {
    const entry = coreEntry(tool, () => ({
      text: 'No-op approval fixture accepted.',
      structured: { accepted: true },
    }));
    if (tool.name === 'fixture_review') {
      entry.name = 'fixture-review';
      entry.origin = { packId: 'approval-fixture-pack', version: '0.0.0-test', prefix: 'fixture' };
    }
    toolRegistry.register(entry);
  }
});
// The real audit stage still runs. Its sink is captured locally, avoiding world writes for this UI proof.
Hooks.once('ready', () => {
  setAuditSink(async () => {});
});
