import { TOOLS, type ToolDefinition } from '@agent-gateway/protocol';
import { HANDLERS } from '../tools/index.js';
import { STAGES, type Stage } from './stages.js';
import type { DispatchResult, OpCall, OpContext, OpErrorCode, OpHandler, OpUser } from './types.js';

export interface DispatcherConfig {
  tools: readonly ToolDefinition[];
  handlers: Readonly<Record<string, OpHandler>>;
  stages: readonly Stage[];
}

const fail = (code: OpErrorCode, message: string): DispatchResult => ({
  error: { code, message },
});

export function summariseIssues(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return issues
    .map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
    .join('; ')
    .replace(/\s+/g, ' ');
}

export function createDispatcher(config: DispatcherConfig) {
  return async function dispatch(call: OpCall, user: OpUser): Promise<DispatchResult> {
    const def = config.tools.find((t) => t.name === call.tool);
    const handler =
      def && Object.hasOwn(config.handlers, def.name) ? config.handlers[def.name] : undefined;
    if (!def || !handler) return fail('TOOL_NOT_FOUND', `Unknown tool "${call.tool}"`);
    if (def.minRole === 'gm' && !user.isGM) {
      return fail('FORBIDDEN', `Tool "${def.name}" requires a GM`);
    }
    const parsed = def.input.safeParse(call.args);
    if (!parsed.success) return fail('INVALID_ARGS', summariseIssues(parsed.error.issues));

    const ctx: OpContext = {
      user,
      agent: call.agent,
      sessionId: call.sessionId,
      tool: def.name,
      args: parsed.data,
    };
    const stages = [...config.stages].sort((a, b) => a.order - b.order);
    const run = async (i: number): Promise<DispatchResult> => {
      const stage = stages[i];
      if (!stage) {
        // Fail closed: a call that needs approval never reaches its handler without it.
        if (ctx.approval && ctx.approved !== true) {
          return fail('DENIED', `Approval is required for "${def.name}" and was not obtained`);
        }
        return handler(ctx);
      }
      let pending: Promise<DispatchResult> | undefined;
      // Once-guard: a stage calling next() twice reuses the first result.
      return stage.run(ctx, () => (pending ??= run(i + 1)));
    };
    try {
      return await run(0);
    } catch (err) {
      console.error(`agent-gateway | tool "${def.name}" failed`, err);
      return fail('INTERNAL', `Tool "${def.name}" failed unexpectedly`);
    }
  };
}

export const dispatch = (call: OpCall, user: OpUser) =>
  createDispatcher({ tools: TOOLS, handlers: HANDLERS, stages: STAGES })(call, user);
