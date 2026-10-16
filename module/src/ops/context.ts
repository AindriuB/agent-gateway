import type { ToolCategory } from '@agent-gateway/protocol';
import type { OpContext, OpHandler } from './types.js';

const ranks: Record<ToolCategory, number> = { read: 0, write: 1, destructive: 2, code: 3 };
const bindings = new WeakMap<OpContext, { base: ToolCategory; effective: ToolCategory }>();
/** Classification is local trusted code, never a category supplied in tool arguments. */
export function actionCategory(tool: string, args: unknown, base: string, core = true): string {
  const action = (args as { action?: unknown } | null)?.action;
  if (
    core &&
    base === 'read' &&
    tool === 'conditions' &&
    (args as { change?: unknown } | null)?.change !== undefined
  )
    return 'write';
  if (
    core &&
    base === 'read' &&
    tool === 'character_build' &&
    (args as { changes?: unknown } | null)?.changes !== undefined
  )
    return 'write';
  if (core && base === 'read' && tool === 'image_assign' && action === 'set') return 'write';
  return core &&
    base === 'write' &&
    ((tool === 'token_manage' && action === 'remove') ||
      (tool === 'combat_manage' && (action === 'end' || action === 'remove_combatants')))
    ? 'destructive'
    : base;
}
export function effectiveCategory(ctx: OpContext, base: string | undefined): string | undefined {
  const bound = bindings.get(ctx);
  if (bound && bound.base !== base) throw Error('Canonical tool category changed');
  return bound?.effective ?? base;
}
export function policyCategories(ctx: OpContext, base: string): string[] {
  return [...new Set([base, effectiveCategory(ctx, base)!])];
}
export function prepareContext(
  ctx: OpContext,
  base: ToolCategory,
  core: boolean,
  handler: OpHandler,
): void {
  let open = true;
  let effective = base;
  Object.defineProperty(ctx, 'escalate', {
    value: (category: ToolCategory) => {
      if (!open || !core || !Object.hasOwn(ranks, category) || ranks[category] < ranks[effective])
        throw Error('Invalid or late category escalation');
      effective = category;
    },
    writable: false,
    configurable: false,
  });
  try {
    if (handler.prepare) {
      if (!core) throw Error('Pack preparation is not authorized');
      const result = handler.prepare(ctx);
      if (result !== undefined) throw Error('Preparation must be synchronous and pure');
    }
    if (effective !== actionCategory(ctx.tool, ctx.args, base, core))
      throw Error('Preparation disagrees with canonical action category');
    bindings.set(ctx, Object.freeze({ base, effective }));
  } finally {
    open = false;
  }
}
/** Attach only to trusted core handlers; never part of an announcement or pack API. */
export function withPreparation(handler: OpHandler): OpHandler {
  handler.prepare = (ctx) => {
    if (actionCategory(ctx.tool, ctx.args, 'write') === 'destructive') ctx.escalate!('destructive');
  };
  return handler;
}
