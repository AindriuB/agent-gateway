import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Config } from './config/index.js';
import { createLogger, type Logger } from './log.js';
import { createMcpServer } from './mcp/index.js';

export interface ModuleConnection {
  readonly worldId: string;
  readonly userId: string;
}

export interface ModuleConnections {
  get(worldId: string, userId: string): ModuleConnection | undefined;
  any(): ModuleConnection | undefined;
}

/** Empty implementation; replaced when the link server lands. */
export class EmptyModuleConnections implements ModuleConnections {
  get(): undefined {
    return undefined;
  }
  any(): undefined {
    return undefined;
  }
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface AppDeps {
  version: string;
  connections?: ModuleConnections;
  logger?: Logger;
}

export function createApp(config: Config, deps: AppDeps): App {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const connections = deps.connections ?? new EmptyModuleConnections();
  let server: Server | undefined;
  return {
    async start() {
      server = createMcpServer({ version: deps.version, role: config.role, connections });
      await server.connect(new StdioServerTransport());
      logger.info(`MCP stdio server started (role ${config.role})`);
    },
    async stop() {
      await server?.close();
      server = undefined;
    },
  };
}
