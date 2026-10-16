import {
  checkToolDefinition,
  type AnnouncedTool,
  type JsonSchemaObject,
  type ToolCategory,
  type ToolRole,
} from '@agent-gateway/protocol';
import type { OpHandler } from './types.js';

export type ToolOrigin = 'core' | { packId: string; version: string; prefix: string };
export type ParsedArgs =
  | { ok: true; data: unknown }
  | { ok: false; issues: readonly { path: PropertyKey[]; message: string }[] };
export interface RegistryEntry {
  name: string;
  category: ToolCategory;
  minRole: ToolRole;
  description: string;
  inputSchema: JsonSchemaObject;
  outputSchema: JsonSchemaObject;
  origin: ToolOrigin;
  redactArgs?: readonly string[];
  parseArgs(args: unknown): ParsedArgs;
  handler: OpHandler;
}
export type ToolInfo = Readonly<Omit<RegistryEntry, 'parseArgs' | 'handler'>>;
export type RegistryLookup = (
  name: string,
) => { parseArgs: RegistryEntry['parseArgs']; handler: OpHandler } | undefined;

export class RegistryError extends Error {
  constructor(
    readonly code: 'SEALED' | 'DUPLICATE' | 'INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

/** Metadata and callable capabilities have separate, private storage. */
export class ToolRegistry {
  #metadata = new Map<string, ToolInfo>();
  #sealed = false;
  #install: (entries: readonly RegistryEntry[]) => void;

  constructor(capture?: (lookup: RegistryLookup) => void) {
    const implementations = new Map<string, NonNullable<ReturnType<RegistryLookup>>>();
    capture?.((name) => implementations.get(name));
    this.#install = (entries) => {
      for (const entry of entries)
        implementations.set(entry.name, { parseArgs: entry.parseArgs, handler: entry.handler });
    };
  }

  register(entry: RegistryEntry): void {
    this.registerAll([entry]);
  }

  registerAll(entries: readonly RegistryEntry[]): void {
    if (this.#sealed) throw new RegistryError('SEALED', 'The tool registry is sealed');
    const pending = new Map<string, ToolInfo>();
    for (const entry of entries) {
      if (this.#metadata.has(entry.name) || pending.has(entry.name))
        throw new RegistryError('DUPLICATE', `Tool "${entry.name}" is already registered`);
      const { name, category, minRole, description, inputSchema, outputSchema, origin } = entry;
      if (origin !== 'core' && (origin === null || typeof origin !== 'object'))
        throw new RegistryError('INVALID', `Tool "${name}": invalid origin`);
      const announced: AnnouncedTool = {
        name,
        category,
        minRole,
        description,
        inputSchema,
        outputSchema,
        ...(origin !== 'core'
          ? { pack: { id: origin.packId, version: origin.version, prefix: origin.prefix } }
          : {}),
      };
      const problems = checkToolDefinition(announced, origin === 'core' ? 'core' : 'pack');
      if (typeof entry.parseArgs !== 'function' || typeof entry.handler !== 'function')
        problems.push('missing parser or handler');
      if (problems.length)
        throw new RegistryError('INVALID', `Tool "${name}": ${problems.join('; ')}`);
      // JSON copies isolate metadata from the caller and exclude callable values at every depth.
      const info = JSON.parse(
        JSON.stringify({
          name,
          category,
          minRole,
          description,
          inputSchema,
          outputSchema,
          origin,
          ...(origin === 'core' && entry.redactArgs ? { redactArgs: entry.redactArgs } : {}),
        }),
      ) as ToolInfo;
      pending.set(name, freezeJson(info));
    }
    this.#install(entries);
    for (const [name, info] of pending) this.#metadata.set(name, info);
  }

  seal(): void {
    this.#sealed = true;
  }

  info(name: string): ToolInfo | undefined {
    return this.#metadata.get(name);
  }

  list(): readonly ToolInfo[] {
    return Object.freeze([...this.#metadata.keys()].map((name) => this.info(name)!));
  }

  forRole(isGM: boolean): readonly ToolInfo[] {
    return Object.freeze(this.list().filter((tool) => isGM || tool.minRole === 'player'));
  }

  categoryOf(name: string): ToolCategory | undefined {
    return this.info(name)?.category;
  }
}

/** Metadata-only readers remain fail closed before dispatcher bootstrap. */
let liveRegistry: ToolRegistry | undefined;
const emptyTools: readonly ToolInfo[] = Object.freeze([]);
export const liveToolMetadata = Object.freeze({
  info: (name: string): ToolInfo | undefined => liveRegistry?.info(name),
  list: (): readonly ToolInfo[] => liveRegistry?.list() ?? emptyTools,
  forRole: (isGM: boolean): readonly ToolInfo[] => liveRegistry?.forRole(isGM) ?? emptyTools,
  categoryOf: (name: string): ToolCategory | undefined => liveRegistry?.categoryOf(name),
});

/** The dispatcher retains the callable capability and installs metadata exactly once. */
export function installToolRegistry(registry: ToolRegistry): void {
  if (liveRegistry) throw new RegistryError('INVALID', 'The live registry is already installed');
  liveRegistry = registry;
}
