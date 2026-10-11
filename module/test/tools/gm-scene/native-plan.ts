/** Pure fixture plan; no browser/network/world activity on import. */
const TASK24_SOURCE = '79f6d713180d021d06cda192584f045edbbfeded';
const TASK24_BUNDLE = '5e23eca373bd9728e837bc7fe9cac135b147ec210635c44ddcec93023683dee0';
/** Defaults pin the verified runtime; overrides must name an explicitly reviewed source/build. */
export function task24ProofPins(source = TASK24_SOURCE, bundle = TASK24_BUNDLE) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Exact Task24 source/bundle pins required');
  return { source, bundle };
}
export type NativeIds = {
  actor: string;
  scene: string;
  combat: string;
  tokens: [string, string];
  combatants: [string, string];
  level: string;
};
export type NativeCall = {
  tool: string;
  args: Record<string, unknown>;
  expected: 'ok' | 'FORBIDDEN' | 'INVALID_ARGS' | 'DENIED';
  audit: boolean;
};
export function task24Calls(ids: NativeIds, generation: 13 | 14 = 14): NativeCall[] {
  const sceneUuid = ids.scene,
    combatUuid = ids.combat;
  const call = (
    tool: string,
    args: Record<string, unknown>,
    expected: NativeCall['expected'] = 'ok',
  ): NativeCall => ({ tool, args, expected, audit: expected !== 'DENIED' });
  return [
    call('scene_control', { action: 'view', sceneUuid }),
    call('scene_control', { action: 'activate', sceneUuid }),
    call('scene_control', { action: 'set_darkness', sceneUuid, darkness: 0.25 }),
    call(
      'scene_control',
      {
        action: 'set_level',
        sceneUuid,
        levelId: generation === 13 ? 'unsupported-level' : ids.level,
      },
      generation === 13 ? 'INVALID_ARGS' : 'ok',
    ),
    call('token_manage', {
      action: 'place',
      sceneUuid,
      actorUuid: ids.actor,
      x: 100,
      y: 100,
      hidden: false,
      rotation: 90,
    }),
    call('token_manage', {
      action: 'place',
      sceneUuid,
      actorUuid: ids.actor,
      x: 400,
      y: 100,
      hidden: false,
      rotation: 0,
    }),
    call('token_manage', { action: 'hide', tokenUuid: ids.tokens[0] }),
    call('combat_manage', { action: 'add_combatants', combatUuid, tokenUuids: ids.tokens }),
    call('token_manage', { action: 'remove', tokenUuid: ids.tokens[0] }, 'FORBIDDEN'),
    call(
      'combat_manage',
      { action: 'roll_initiative', combatUuid, combatantUuids: ids.combatants },
      'INVALID_ARGS',
    ),
    call('combat_manage', { action: 'start', combatUuid }),
    call('combat_manage', { action: 'next_turn', combatUuid }),
    call('combat_manage', { action: 'end', combatUuid }, 'DENIED'),
    call('combat_manage', { action: 'end', combatUuid }),
    call('token_manage', { action: 'remove', tokenUuid: ids.tokens[0] }),
    call('token_manage', { action: 'remove', tokenUuid: ids.tokens[1] }),
  ];
}
export function task24FixtureData(run: string, generation: 13 | 14 = 14) {
  if (!/^[a-f0-9]{12}$/.test(run)) throw Error('Bounded fixture nonce required');
  const prefix = `ag-task24-${run}`,
    flags = { world: { task24: run } };
  return {
    actor: {
      name: `${prefix}-npc`,
      type: 'npc',
      ownership: { default: 0 },
      items: [],
      effects: [],
      flags,
    },
    scene: {
      name: `${prefix}-scene`,
      width: 2000,
      height: 2000,
      padding: 0,
      grid: { type: 1, size: 100, distance: 5, units: 'ft' },
      active: false,
      navigation: false,
      tokenVision: false,
      environment: { darknessLevel: 0, darknessLock: false },
      playlist: null,
      ownership: { default: 0 },
      flags,
      ...(generation === 14
        ? {
            levels: [
              { name: `${prefix}-lower`, elevation: { bottom: 0, top: 10 } },
              { name: `${prefix}-upper`, elevation: { bottom: 10, top: 20 } },
            ],
          }
        : {}),
    },
    combat: { name: `${prefix}-combat`, active: true, round: 0, turn: null, combatants: [], flags },
  };
}
/** Never let a prior same-arguments refusal satisfy a later successful call. */
export function freshCallAudit<
  T extends {
    uuid: string;
    userId: string;
    agentId: string;
    tool: string;
    args: string;
    status: string;
  },
>(
  rows: T[],
  baseline: readonly string[],
  identity: { userId: string; agentId: string },
  call: NativeCall,
  requireExpectedStatus = true,
): T {
  const matches = rows.filter(
    (r) =>
      !baseline.includes(r.uuid) &&
      r.userId === identity.userId &&
      r.agentId === identity.agentId &&
      r.tool === call.tool &&
      same(JSON.parse(r.args), call.args),
  );
  if (
    matches.length !== 1 ||
    (requireExpectedStatus && matches[0]!.status !== (call.expected === 'ok' ? 'ok' : 'error'))
  )
    throw Error('Exact fresh audit record is missing or ambiguous');
  return matches[0]!;
}
/** Revalidate the exact captured record despite later identical arguments. */
export function capturedCallAudit<
  T extends {
    uuid: string;
    entryId: string;
    userId: string;
    agentId: string;
    tool: string;
    args: string;
    status: string;
  },
>(
  rows: T[],
  baseline: readonly string[],
  identity: { userId: string; agentId: string },
  call: NativeCall,
  captured: { uuid: string; entryId: string },
): T {
  if (!captured.uuid || !captured.entryId) throw Error('Captured audit identity unavailable');
  const exact = rows.filter((row) => row.uuid === captured.uuid);
  if (exact.length !== 1 || exact[0]!.entryId !== captured.entryId)
    throw Error('Captured audit identity missing or replaced');
  return freshCallAudit(exact, baseline, identity, call);
}

function same(a: unknown, b: unknown): boolean {
  const normal = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normal)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, normal(x)]),
          )
        : v;
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}
/** Audit acceptance stays bounded to actual supported targets; it never expands Undo authority. */
export function assertTask24Audit(
  row: {
    category: string;
    targets: Array<{ uuid: string; existed: boolean; before: unknown; existsAfter: boolean }>;
  },
  call: NativeCall,
) {
  const action = call.args.action;
  const destructive =
    (call.tool === 'token_manage' && action === 'remove') ||
    (call.tool === 'combat_manage' && ['end', 'remove_combatants'].includes(String(action)));
  if (row.category !== (destructive ? 'destructive' : 'write'))
    throw Error('Audit effective category mismatch');
  if (call.expected !== 'ok' || action === 'view' || action === 'set_level') {
    if (row.targets.length !== 0)
      throw Error('Read-only/refused action unexpectedly captured mutation targets');
  } else if (action === 'place' || action === 'add_combatants') {
    const prefix =
      action === 'place' ? `${call.args.sceneUuid}.Token.` : `${call.args.combatUuid}.Combatant.`;
    const count = action === 'place' ? 1 : (call.args.tokenUuids as string[]).length;
    if (
      row.targets.length !== count ||
      row.targets.some(
        (t) => !t.uuid.startsWith(prefix) || t.existed !== false || t.existsAfter !== true,
      )
    )
      throw Error('Created audit targets mismatch');
  } else if (
    row.targets.length === 0 ||
    row.targets.some((t) => !t.existed || typeof t.before !== 'string' || !t.before)
  )
    throw Error('Mutation before snapshots missing');
}
