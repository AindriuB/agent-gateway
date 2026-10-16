/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { imageAssign } from '@agent-gateway/protocol';
import { createDispatcher } from '../../../src/ops/dispatch.js';
import { effectiveCategory } from '../../../src/ops/context.js';
import { createAuditStage } from '../../../src/audit/stage.js';
import { HANDLERS } from '../../../src/tools/index.js';
import type { Stage } from '../../../src/ops/stages.js';
import { g, gm, setup } from './fixtures.js';

let f: ReturnType<typeof setup>, seen: string[], records: any[];
beforeEach(() => {
  f = setup(14);
  seen = [];
  records = [];
});
afterEach(() => f.restore());
function dispatcher() {
  const stages: Stage[] = [
    ...['policy', 'rate', 'approval'].map((name, i) => ({
      name,
      order: 20 + i * 5,
      async run(ctx: any, next: any) {
        seen.push(`${name}:${effectiveCategory(ctx, imageAssign.category)}`);
        return next();
      },
    })),
    createAuditStage({
      categoryOf: () => imageAssign.category,
      isGM: () => true,
      fromUuid: async (uuid: string) => g.fromUuid(uuid),
      submit: async (r) => {
        records.push(r);
      },
      newId: () => 'entry-image0001',
      now: () => 1,
      watchChanges: () => () => {},
    }),
  ];
  return createDispatcher({
    tools: [imageAssign],
    handlers: { image_assign: HANDLERS.image_assign! },
    stages,
  });
}
const call = (args: any) => ({
  tool: 'image_assign',
  args,
  agent: { id: 'agent', ownerUserId: 'gm', headless: false },
  sessionId: 'session',
});

it('list reaches policy, rate and approval as read, with no audit record', async () => {
  g.game.user = gm;
  const r: any = await dispatcher()(call({ action: 'list' }), gm);
  expect(r.structured.files).toHaveLength(1);
  expect(seen).toEqual(['policy:read', 'rate:read', 'approval:read']);
  expect(records).toEqual([]);
});
it('set reaches the stages as write and produces one audit record', async () => {
  g.game.user = gm;
  const r: any = await dispatcher()(
    call({ action: 'set', path: 'x.png', target: 'actor_portrait', uuid: 'Actor.a' }),
    gm,
  );
  expect(r.error).toBeUndefined();
  expect(seen).toEqual(['policy:write', 'rate:write', 'approval:write']);
  expect(records).toHaveLength(1);
  expect(records[0].category).toBe('write');
  expect(f.docs.actor.img).toBe('x.png');
  expect(f.docs.actor.update).toHaveBeenCalledWith(
    { img: 'x.png' },
    expect.objectContaining({ agentGateway: { callId: 'entry-image0001' } }),
  );
});
