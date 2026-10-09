import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { defineTool } from '@agent-gateway/protocol/tools';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EmptyModuleConnections } from '../../src/app.js';
import { createMcpServer } from '../../src/mcp/index.js';

const fixture = defineTool({
  name: 'fixture_tool',
  minRole: 'player',
  category: 'read',
  handledBy: 'module',
  description: 'fixture',
  input: z.object({ a: z.string() }),
  output: z.object({ b: z.string() }),
});

async function connect(tools: Parameters<typeof createMcpServer>[0]['tools']) {
  const server = createMcpServer({
    version: '0.0.0',
    role: 'player',
    connections: new EmptyModuleConnections(),
    tools,
  });
  const client = new Client({ name: 't', version: '0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('mcp server', () => {
  it('lists [] for an empty registry', async () => {
    expect((await (await connect([])).listTools()).tools).toEqual([]);
  });
  it('lists registered tools with JSON Schema', async () => {
    const { tools } = await (await connect([fixture])).listTools();
    expect(tools.map((t) => t.name)).toEqual(['fixture_tool']);
    expect(tools[0]?.inputSchema.type).toBe('object');
  });
  it('answers calls with world offline', async () => {
    const res = await (await connect([fixture])).callTool({ name: 'fixture_tool', arguments: {} });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain('world offline');
    expect(res.structuredContent).toEqual({ code: 'WORLD_OFFLINE' });
  });
});

describe('cli', () => {
  const cli = fileURLToPath(new URL('../../dist/bin/cli.js', import.meta.url));
  it('writes only JSON-RPC to stdout', async () => {
    const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 't', version: '0' },
      },
    });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    await new Promise((r) => setTimeout(r, 1500));
    child.kill();
    const lines = out.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const l of lines) expect(JSON.parse(l).jsonrpc).toBe('2.0');
  });
  it('exits 2 on unknown flags', async () => {
    const child = spawn(process.execPath, [cli, '--bogus'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const code = await new Promise((r) => child.on('close', r));
    expect(code).toBe(2);
    expect(err).toContain('Usage');
  });
});
