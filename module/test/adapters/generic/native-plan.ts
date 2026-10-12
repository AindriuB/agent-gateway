/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  actorSummaryOutput,
  actionsListOutput,
  inventoryOutput,
  conditionsOutput,
} from '@agent-gateway/protocol';
export const TASK31_NATIVE_PINS = Object.freeze({
  source: '68e1b4216ad05cfe77ff138b5045768aca776a59',
  bundle: 'cde74e8bd0252019a53cdfad410fe08ebc3ce041b67460e55430379bbe48e945',
});
export function task31NativePlan(run: string, gmId: string, uuid = 'Actor.pending') {
  if (
    !/^[a-f0-9]{12}$/.test(run) ||
    !gmId ||
    gmId.length > 100 ||
    !/^Actor\.[A-Za-z0-9]+$/.test(uuid)
  )
    throw Error('Bounded native identity required');
  return {
    fixtureCount: 1,
    toolRequests: 6,
    retainedAudits: 2,
    actor: {
      name: `Task31-${run}-NPC`,
      type: 'npc',
      ownership: { default: 0, [gmId]: 3 },
      items: [],
      effects: [],
      flags: { world: { task31: run } },
    },
    calls: [
      { name: 'actor_summary', args: { actorUuid: uuid } },
      { name: 'actions_list', args: { actorUuid: uuid } },
      { name: 'inventory', args: { actorUuid: uuid } },
      { name: 'conditions', args: { actorUuid: uuid } },
      {
        name: 'action_perform',
        args: { actorUuid: uuid, actionId: `Task31-${run}-unsupported`, options: '{}' },
      },
      {
        name: 'conditions',
        args: {
          actorUuid: uuid,
          change: { id: `Task31-${run}-unsupported`, active: true, value: 1 },
        },
      },
    ],
  };
}
export function task31ReadResult(index: number, result: any, created: any) {
  if (result?.isError) throw Error('Generic native read refused');
  const schemas = [actorSummaryOutput, actionsListOutput, inventoryOutput, conditionsOutput];
  const data = schemas[index]!.parse(result?.structuredContent);
  if (data.actorUuid !== created.uuid || data.systemId !== 'pf2e')
    throw Error('Native result identity mismatch');
  if (index === 0) {
    if (
      JSON.stringify(data) !==
      JSON.stringify({
        actorUuid: created.uuid,
        systemId: 'pf2e',
        name: created.source.name,
        img: created.source.img,
        type: 'npc',
        attributes: [],
      })
    )
      throw Error('Generic summary differs from exact native metadata');
  } else if (
    JSON.stringify(data) !==
    JSON.stringify(
      index === 1
        ? { actorUuid: created.uuid, systemId: 'pf2e', supported: false, actions: [] }
        : index === 2
          ? { actorUuid: created.uuid, systemId: 'pf2e', supported: false, items: [], totals: [] }
          : { actorUuid: created.uuid, systemId: 'pf2e', supported: false, conditions: [] },
    )
  )
    throw Error('Generic unsupported read contract mismatch');
  return data;
}
export function task31OnceRecord(record: any, spec: any, gmName: string, agentId: string) {
  if (
    record?.tool !== spec.name ||
    JSON.stringify(record.args) !== JSON.stringify(spec.args) ||
    record.category !== 'write' ||
    record.approver !== 'owner' ||
    record.agentId !== agentId ||
    record.status !== 'approved' ||
    record.scope !== 'once' ||
    record.resolvedBy !== gmName ||
    record.result?.failed !== true ||
    !record.result.text.includes('INVALID_ARGS') ||
    !record.result.text.includes('not supported for pf2e')
  )
    throw Error('Exact native unsupported once approval required');
  return record;
}
export function task31AuditRows(
  rows: any[],
  plan: ReturnType<typeof task31NativePlan>,
  created: any,
  gmId: string,
  agentId: string,
) {
  if (rows.length !== 2) throw Error('Exactly two failed mutation audits required');
  for (const spec of plan.calls.slice(4)) {
    const row = rows.find((r) => r.tool === spec.name && r.args === JSON.stringify(spec.args));
    if (
      !row ||
      row.status !== 'error' ||
      row.result !== 'INVALID_ARGS: Operation not supported for pf2e' ||
      row.argsTruncated !== false ||
      row.targetsDropped !== 0 ||
      row.relayed !== false ||
      row.category !== 'write' ||
      row.userId !== gmId ||
      row.agentId !== agentId ||
      row.targets.length !== 1 ||
      row.targets[0].uuid !== created.uuid ||
      JSON.stringify(row.targets[0].before) !== JSON.stringify(created.source)
    )
      throw Error('Exact native unsupported audit mismatch');
  }
  return rows;
}

/** A tracked request may reach approval after an empty queue snapshot. Never delete its target. */
export function task31CleanupReady(pendingCount: number, calls: readonly { terminal: boolean }[]) {
  return pendingCount === 0 && calls.every((call) => call.terminal);
}

/** TLS exception is opt-in and cannot redirect beyond the exact approved local Foundry origin. */
export function task31InstalledRequest(origin: string, generation: 13 | 14, insecureTLS: boolean) {
  if (origin !== (generation === 13 ? 'https://foundry13.local' : 'https://foundry.local'))
    throw Error('Exact approved installed-bundle origin required');
  return {
    url: `${origin}/modules/agent-gateway/dist/module/main.js`,
    options: { ignoreHTTPSErrors: insecureTLS, maxRedirects: 0, timeout: 20000 },
  };
}
