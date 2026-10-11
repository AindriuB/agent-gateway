import { readNativeWritePolicy } from '../player-writes/live-policy.js';
/** Pure bounded fixture payloads and identity checks used by the native acceptance harness. */
export const TASK23_SOURCE = 'Compendium.pf2e.equipment-srd.Item.rQWaJhI5Bko5x14Z';
export function nativeDocumentPlan(run: string) {
  if (!/^[a-f0-9]{12}$/.test(run)) throw Error('Invalid fixture nonce');
  const prefix = `ag-task23-${run}`;
  return {
    prefix,
    actor: {
      name: `${prefix}-npc`,
      type: 'npc',
      ownership: { default: 0 },
      flags: { world: { task23: { run, obsolete: 'remove' } } },
    },
    journal: { name: `${prefix}-journal`, ownership: { default: 0 } },
    effect: { name: `${prefix}-dead-effect`, statuses: ['dead'], disabled: false },
    page: {
      name: `${prefix}-page`,
      type: 'text',
      text: { format: 1, content: `<p>${prefix} before</p>` },
    },
    actorUpdate: {
      name: `${prefix}-npc-updated`,
      'flags.world.task23.phase': 'updated',
      'flags.world.task23.-=obsolete': null,
    },
    pageUpdate: { text: { content: `<p>${prefix} after</p>` } },
  };
}
export function returnedDocumentUuid(
  result: { structured?: unknown; text: string },
  type: string,
  parent?: string,
): string {
  const structured = result.structured as { uuid?: unknown } | undefined;
  const prefix = parent ? `${parent}.${type}.` : `${type}.`;
  const candidates =
    result.text.match(/[A-Za-z]+\.[A-Za-z0-9]{16}(?:\.[A-Za-z]+\.[A-Za-z0-9]{16})*/g) ?? [];
  const value =
    typeof structured?.uuid === 'string'
      ? structured.uuid
      : candidates.find((uuid) => uuid.startsWith(prefix));
  if (!value?.startsWith(prefix) || !/^[A-Za-z0-9]{16}$/.test(value.slice(prefix.length)))
    throw Error(`Missing canonical ${type} return UUID`);
  return value;
}
/** Compare native root snapshots while ignoring only server lifecycle timestamps/provenance. */
export function undoComparable(value: unknown): unknown {
  // Only supported document roots and their actual embedded collection entries have native stats.
  const normalize = (item: unknown, document: boolean): unknown => {
    if (Array.isArray(item)) return item.map((child) => normalize(child, document));
    if (item !== null && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .filter(([key]) => !document || key !== '_stats')
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [
            key,
            normalize(
              child,
              document && ['items', 'effects', 'pages'].includes(key) && Array.isArray(child),
            ),
          ]),
      );
    return item;
  };
  return normalize(value, true);
}
export interface NativeDiffCard {
  tool: string;
  uuid: string;
  rows: Array<{ path: string; before: string; after: string }>;
}
export function assertNativeUpdateDiff(
  cards: NativeDiffCard[],
  input: { actor: string; page: string; run: string },
) {
  const plan = nativeDocumentPlan(input.run);
  const expected = [
    {
      uuid: input.actor,
      rows: [
        ['name', JSON.stringify(plan.actor.name), JSON.stringify(plan.actorUpdate.name)],
        ['flags.world.task23.phase', '—', '"updated"'],
        ['flags.world.task23.obsolete', '"remove"', '—'],
      ],
    },
    {
      uuid: input.page,
      rows: [
        [
          'text.content',
          JSON.stringify(plan.page.text.content),
          JSON.stringify(plan.pageUpdate.text.content),
        ],
      ],
    },
  ];
  if (cards.length !== 2) throw Error('Expected two native update diff cards');
  for (const exp of expected) {
    const matched = cards.filter(
      (card) => card.tool === 'document_update' && card.uuid === exp.uuid,
    );
    if (matched.length !== 1) throw Error('Native update card identity mismatch');
    for (const [path, before, after] of exp.rows)
      if (
        !matched[0]!.rows.some(
          (row) => row.path === path && row.before === before && row.after === after,
        )
      )
        throw Error(`Native approval diff missing expected ${path}`);
  }
}
export function assertNativeApprovalCards(
  cards: Array<{ id: string; tool: string; args: Record<string, unknown> }>,
  specs: Array<{ name: string; args: Record<string, unknown> }>,
) {
  const key = (tool: string, args: Record<string, unknown>) =>
    JSON.stringify([
      tool,
      Object.keys(args)
        .sort()
        .map((name) => [name, args[name]]),
    ]);
  if (
    cards.length !== specs.length ||
    new Set(cards.map((card) => card.id)).size !== cards.length ||
    cards.some((card) => !/^[A-Za-z0-9_-]{22,64}$/.test(card.id))
  )
    throw Error('Native approval count/identity mismatch');
  const remaining = specs.map((spec) => key(spec.name, spec.args));
  for (const card of cards) {
    const index = remaining.indexOf(key(card.tool, card.args));
    if (index < 0) throw Error('Native approval tool/arguments differ from exact planned batch');
    remaining.splice(index, 1);
  }
}
/** Existing pure validator checks legacy/envelope shape; task23 additionally needs destructive approval. */
export function nativeDestructivePolicy(raw: unknown): string {
  readNativeWritePolicy(raw);
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const root = value as {
    version?: unknown;
    world?: unknown;
    gmAgents?: { destructive?: unknown };
  };
  const world = ('version' in root ? root.world : root) as { gmAgents: { destructive: string } };
  return world.gmAgents.destructive;
}
export interface NativeResumeCheckpoint {
  version: 'v14';
  fixtureRun: string;
  userId: string;
  agentId: string;
  created: string[];
  roots: string[];
  snapshots: Record<string, unknown>[];
  audits: Array<{
    uuid: string;
    system: { status: string; userId: string; agentId: string; relayed: boolean };
  }>;
  deleteAudit: { uuid: string; id: string };
  originalSourceUnavailable: boolean;
  originalSource?: { uuid: string; source: Record<string, unknown> };
  originalBaselines?: {
    baselineRoots: string[];
    auditBaseline: string[];
    originalCombats: Array<{ uuid: string; active: boolean; round: number; turn: number | null }>;
    originalView: unknown;
    originalWorldTime: number;
  };
}
/** Resume requests no MCP mutation; identity is rechecked against fresh trusted native audit before UI. */
export function assertNativeResumeCheckpoint(
  value: unknown,
): asserts value is NativeResumeCheckpoint {
  const c = value as NativeResumeCheckpoint | undefined;
  if (
    !c ||
    c.version !== 'v14' ||
    !/^[a-f0-9]{12}$/.test(c.fixtureRun) ||
    typeof c.userId !== 'string' ||
    typeof c.agentId !== 'string' ||
    !Array.isArray(c.created) ||
    c.created.length !== 5 ||
    new Set(c.created).size !== 5 ||
    !Array.isArray(c.roots) ||
    c.roots.length !== 3 ||
    new Set(c.roots).size !== 3 ||
    c.roots.some(
      (uuid) =>
        !c.created.includes(uuid) || !/^(Actor|Item|JournalEntry)\.[A-Za-z0-9]{16}$/.test(uuid),
    ) ||
    !Array.isArray(c.snapshots) ||
    c.snapshots.length !== 3 ||
    c.snapshots.some((data, i) => data._id !== c.roots[i]!.split('.').at(-1)) ||
    !Array.isArray(c.audits) ||
    c.audits.length !== 8 ||
    new Set(c.audits.map((row) => row.uuid)).size !== 8 ||
    c.audits.some(
      (row) =>
        row.system.status !== 'ok' ||
        row.system.relayed ||
        row.system.userId !== c.userId ||
        row.system.agentId !== c.agentId,
    ) ||
    !c.audits.some((row) => row.uuid === c.deleteAudit?.uuid) ||
    !c.deleteAudit.uuid.endsWith(`.${c.deleteAudit.id}`) ||
    (c.originalSourceUnavailable !== true &&
      (c.originalSourceUnavailable !== false ||
        c.originalSource?.uuid !== TASK23_SOURCE ||
        !c.originalSource.source ||
        typeof c.originalSource.source !== 'object' ||
        !c.originalBaselines ||
        !Array.isArray(c.originalBaselines.baselineRoots) ||
        !Array.isArray(c.originalBaselines.auditBaseline) ||
        !Array.isArray(c.originalBaselines.originalCombats) ||
        !Number.isFinite(c.originalBaselines.originalWorldTime)))
  )
    throw Error('Invalid exact native resume checkpoint');
}

/** Every executable must name the reviewed local build; never silently select whatever is present. */
export function assertNativeBundleHash(actual: string, expected: string | undefined): void {
  if (!expected || !/^[a-f0-9]{64}$/.test(expected) || actual !== expected)
    throw Error('Set AGENT_GATEWAY_TASK23_EXPECTED_BUNDLE_SHA to the reviewed local build SHA-256');
}
