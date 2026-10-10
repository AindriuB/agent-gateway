import {
  PACK_API_VERSION,
  PACK_ID_PATTERN,
  PACK_VERSION_PATTERN,
  PACK_PREFIX_PATTERN,
  RESERVED_PACK_PREFIXES,
  TOOL_LIMITS,
  checkToolDefinition,
  parseApiVersion,
  validateArgs,
  type AnnouncedTool,
  type JsonSchemaObject,
  type ToolCategory,
  type ToolRole,
} from '@agent-gateway/protocol';
import type { ToolRegistry } from '../ops/registry-class.js';
import type { DispatchResult, OpContext } from '../ops/types.js';

export type PackErrorCode =
  'SEALED' | 'API_VERSION' | 'INACTIVE' | 'PREFIX_TAKEN' | 'DUPLICATE' | 'INVALID_TOOL';
export class PackError extends Error {
  constructor(
    readonly code: PackErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PackError';
  }
}
export interface PackContext {
  readonly user: Readonly<{ id: string; isGM: boolean }>;
  readonly agent: Readonly<{ id: string; headless: boolean }>;
  readonly sessionId: string;
  readonly tool: string;
  readonly args: unknown;
  readonly callOptions?: OpContext['callOptions'];
  readonly snapshot?: OpContext['snapshot'];
  readonly created?: OpContext['created'];
  readonly intendCreate?: OpContext['intendCreate'];
}
export interface PackTool {
  name: string;
  description: string;
  category: ToolCategory;
  minRole: ToolRole;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  handler(ctx: PackContext): unknown;
}
export interface PackSpec {
  id: string;
  version: string;
  apiVersion: string;
  prefix: string;
  tools: PackTool[];
}
export interface PackApi {
  readonly packApiVersion: typeof PACK_API_VERSION;
  registerPack(spec: PackSpec): void;
  isSealed(): boolean;
}
export interface PackEnvironment {
  active(id: string): boolean;
  translate(key: string): string;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function view(ctx: OpContext): PackContext {
  return freeze({
    user: { id: ctx.user.id, isGM: ctx.user.isGM },
    agent: { id: ctx.agent.id, headless: ctx.agent.headless },
    sessionId: ctx.sessionId,
    tool: ctx.tool,
    args: copy(ctx.args),
    ...(ctx.callOptions ? { callOptions: copy(ctx.callOptions) } : {}),
    ...(ctx.snapshot ? { snapshot: ctx.snapshot.bind(ctx) } : {}),
    ...(ctx.created ? { created: ctx.created.bind(ctx) } : {}),
    ...(ctx.intendCreate ? { intendCreate: ctx.intendCreate.bind(ctx) } : {}),
  });
}
function checkedResult(id: string, schema: JsonSchemaObject, value: unknown): DispatchResult {
  const invalid = (reason: string): DispatchResult => {
    console.error(`agent-gateway | Tool pack ${id} returned an invalid result: ${reason}`);
    return { error: { code: 'INTERNAL', message: `Tool pack ${id} returned an invalid result` } };
  };
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return invalid('not an object');
    // Read once and detach before checking: accessors cannot change the result after validation.
    const result = copy(value) as Record<string, unknown>;
    if ('error' in result) {
      const error = result.error as Record<string, unknown> | null;
      if (
        !error ||
        !['INVALID_ARGS', 'FORBIDDEN'].includes(String(error.code)) ||
        typeof error.message !== 'string' ||
        error.message.length > 500
      )
        return invalid('invalid error');
      return {
        error: { code: error.code as 'INVALID_ARGS' | 'FORBIDDEN', message: error.message },
      };
    }
    if (
      typeof result.text !== 'string' ||
      !result.structured ||
      typeof result.structured !== 'object' ||
      Array.isArray(result.structured)
    )
      return invalid('invalid shape');
    const bytes = (v: string) => new TextEncoder().encode(v).length;
    if (
      bytes(result.text) > TOOL_LIMITS.resultTextBytes ||
      bytes(JSON.stringify(result.structured)) > TOOL_LIMITS.resultStructuredBytes
    )
      return invalid('size limit');
    const parsed = validateArgs(schema, result.structured);
    if (!parsed.ok) return invalid('output schema mismatch');
    if (bytes(JSON.stringify(parsed.value)) > TOOL_LIMITS.resultStructuredBytes)
      return invalid('validated output size limit');
    return { text: result.text, structured: parsed.value as Record<string, unknown> };
  } catch {
    return invalid('not serializable');
  }
}

/** Capabilities stay in closures; the public object exposes registration only. */
export function createPackApi(registry: ToolRegistry, env: PackEnvironment) {
  let sealed = false;
  const ids = new Set<string>();
  const prefixes = new Set<string>();
  const refuse = (code: PackErrorCode, detail: string): never => {
    const message = code === 'SEALED' ? env.translate('AGENT_GATEWAY.Packs.Sealed') : detail;
    console.error(`agent-gateway | Pack registration refused (${code}): ${message}`);
    throw new PackError(code, message);
  };
  const registerPack = (input: PackSpec): void => {
    if (sealed) refuse('SEALED', '');
    try {
      // Select every field once; JSON-copy only metadata, retaining handlers separately.
      const { id, version, apiVersion, prefix, tools } = input;
      if (!Array.isArray(tools)) refuse('INVALID_TOOL', 'Invalid tool count');
      const count = tools.length;
      if (!Number.isInteger(count) || count < 0 || count > TOOL_LIMITS.toolsPerPack)
        refuse('INVALID_TOOL', 'Invalid tool count');
      const handlers: unknown[] = [];
      const metadata = [];
      for (let index = 0; index < count; index++) {
        const tool = tools[index]!;
        const { name, description, category, minRole, inputSchema, outputSchema, handler } = tool;
        handlers.push(handler);
        metadata.push({ name, description, category, minRole, inputSchema, outputSchema });
      }
      const spec = freeze(copy({ id, version, apiVersion, prefix, tools: metadata }));
      const parsedVersion = parseApiVersion(spec.apiVersion);
      if (!parsedVersion || parsedVersion.major !== parseApiVersion(PACK_API_VERSION)!.major)
        refuse('API_VERSION', 'Unsupported pack API version');
      if (spec.id === 'agent-gateway' || !env.active(spec.id))
        refuse('INACTIVE', 'Pack module is inactive');
      if (
        typeof spec.id !== 'string' ||
        !PACK_ID_PATTERN.test(spec.id) ||
        typeof spec.version !== 'string' ||
        !PACK_VERSION_PATTERN.test(spec.version) ||
        typeof spec.prefix !== 'string' ||
        !PACK_PREFIX_PATTERN.test(spec.prefix)
      )
        refuse('INVALID_TOOL', 'Invalid pack metadata');
      if (ids.has(spec.id)) refuse('DUPLICATE', 'Pack id is already registered');
      if (RESERVED_PACK_PREFIXES.has(spec.prefix) || prefixes.has(spec.prefix))
        refuse('PREFIX_TAKEN', 'Pack prefix is reserved or already registered');
      const entries = spec.tools.map((tool, index) => {
        const definition: AnnouncedTool = {
          ...tool,
          name: `${spec.prefix}-${tool.name}`,
          pack: { id: spec.id, version: spec.version, prefix: spec.prefix },
        };
        const problems = checkToolDefinition(definition, 'pack');
        const handler = handlers[index];
        if (typeof handler !== 'function') problems.push('Missing handler');
        if (problems.length) refuse('INVALID_TOOL', problems.join('; '));
        return {
          ...tool,
          name: definition.name,
          origin: { packId: spec.id, version: spec.version, prefix: spec.prefix },
          parseArgs: (args: unknown) => {
            const parsed = validateArgs(tool.inputSchema, args);
            return parsed.ok
              ? { ok: true as const, data: parsed.value }
              : {
                  ok: false as const,
                  issues: parsed.issues.map((issue) => ({
                    path: [issue.path],
                    message: issue.message,
                  })),
                };
          },
          handler: async (ctx: OpContext) => {
            const result: unknown = await (handler as PackTool['handler'])(view(ctx));
            return checkedResult(spec.id, tool.outputSchema, result);
          },
        };
      });
      registry.registerAll(entries);
      ids.add(spec.id);
      prefixes.add(spec.prefix);
    } catch (error) {
      if (error instanceof PackError) throw error;
      refuse('INVALID_TOOL', 'Invalid pack specification');
    }
  };
  const api: PackApi = Object.freeze({
    packApiVersion: PACK_API_VERSION,
    registerPack,
    isSealed: () => sealed,
  });
  return {
    api,
    seal: () => {
      sealed = true;
      registry.seal();
    },
  };
}
