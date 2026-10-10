import { checkToolDefinition, type ToolDefinition } from '@agent-gateway/protocol';
import { coreEntry, registerCoreTools } from './core-tools.js';
import { ToolRegistry, installToolRegistry, type RegistryLookup } from './registry-class.js';
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

export function createRegistryDispatcher(
  registry: ToolRegistry,
  lookup: RegistryLookup,
  configuredStages: readonly Stage[],
) {
  return async function dispatch(call: OpCall, user: OpUser): Promise<DispatchResult> {
    const def = registry.info(call.tool);
    const implementation = lookup(call.tool);
    const handler = implementation?.handler;
    if (!def || !handler) return fail('TOOL_NOT_FOUND', `Unknown tool "${call.tool}"`);
    if (def.minRole === 'gm' && !user.isGM) {
      return fail('FORBIDDEN', `Tool "${def.name}" requires a GM`);
    }
    const parsed = implementation!.parseArgs(call.args);
    if (!parsed.ok) return fail('INVALID_ARGS', summariseIssues(parsed.issues));

    const ctx: OpContext = {
      user,
      agent: call.agent,
      sessionId: call.sessionId,
      tool: def.name,
      args: parsed.data,
    };
    const stages = [...configuredStages].sort((a, b) => a.order - b.order);
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

/** Compatibility factory for existing injected Zod definitions and handler subsets. */
export function createDispatcher(config: DispatcherConfig) {
  let lookup!: RegistryLookup;
  const registry = new ToolRegistry((value) => {
    lookup = value;
  });
  for (const tool of config.tools) {
    if (!Object.hasOwn(config.handlers, tool.name)) continue;
    const entry = coreEntry(tool, config.handlers[tool.name]!);
    // Legacy injected fixtures include unknown schemas and deliberately invalid categories.
    // They are never announced. Use conservative synthetic metadata only when their JSON
    // representation fails today's rules, and retain the original Zod parser and role.
    if (checkToolDefinition(entry, 'core').length) {
      entry.inputSchema = { type: 'object', properties: {}, additionalProperties: false };
      entry.outputSchema = { type: 'object', properties: {}, additionalProperties: false };
      if (!['read', 'write', 'destructive', 'code'].includes(entry.category))
        entry.category = 'write';
    }
    registry.register(entry);
  }
  return createRegistryDispatcher(registry, lookup, config.stages);
}

let liveLookup!: RegistryLookup;
export const toolRegistry = new ToolRegistry((lookup) => {
  liveLookup = lookup;
});
installToolRegistry(toolRegistry);
registerCoreTools(toolRegistry);
export const dispatch = (call: OpCall, user: OpUser): Promise<DispatchResult> =>
  createRegistryDispatcher(toolRegistry, liveLookup, STAGES)(call, user);
