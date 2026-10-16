import { TOOLS, toJsonSchema, type ToolDefinition } from '@agent-gateway/protocol';
import { HANDLERS } from '../tools/index.js';
import { RegistryError, type RegistryEntry, type ToolRegistry } from './registry-class.js';
import type { OpHandler } from './types.js';

export function coreEntry(tool: ToolDefinition, handler: OpHandler): RegistryEntry {
  return {
    name: tool.name,
    category: tool.category,
    minRole: tool.minRole,
    description: tool.description,
    ...toJsonSchema(tool),
    origin: 'core',
    ...(tool.redactArgs ? { redactArgs: tool.redactArgs } : {}),
    parseArgs(args) {
      const parsed = tool.input.safeParse(args);
      return parsed.success
        ? { ok: true, data: parsed.data }
        : { ok: false, issues: parsed.error.issues };
    },
    handler,
  };
}

export function registerCoreTools(
  registry: ToolRegistry,
  tools: readonly ToolDefinition[] = TOOLS,
  handlers: Readonly<Record<string, OpHandler>> = HANDLERS,
): void {
  const moduleTools = tools.filter((tool) => tool.handledBy === 'module');
  const entries = moduleTools.map((tool) => {
    if (!Object.hasOwn(handlers, tool.name))
      throw new RegistryError('INVALID', `Core tool "${tool.name}" has no handler`);
    return coreEntry(tool, handlers[tool.name]!);
  });
  for (const name of Object.keys(handlers))
    if (!moduleTools.some((tool) => tool.name === name))
      throw new RegistryError('INVALID', `Core handler "${name}" has no definition`);
  registry.registerAll(entries);
}
