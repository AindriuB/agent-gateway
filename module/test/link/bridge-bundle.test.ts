/* eslint-disable @typescript-eslint/no-explicit-any */
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@agent-gateway/protocol';
import { installFoundry } from '../stubs/foundry.js';

it('production bundle dispatches a linked world_info call after real lifecycle initialization', async () => {
  // Use the real entry point, production chunk ordering and default bridge dispatcher.
  // An injected-dispatch unit test cannot catch an eager binding captured during a cycle.
  const built = await build({
    configFile: new URL('../../vite.config.ts', import.meta.url).pathname,
    root: new URL('../..', import.meta.url).pathname,
    logLevel: 'silent',
    build: { write: false },
  });
  const output = Array.isArray(built) ? built[0] : built;
  if (!output || !('output' in output)) throw new Error('Expected a production bundle');
  const chunk = output.output.find((file) => file.type === 'chunk');
  if (!chunk || chunk.type !== 'chunk') throw new Error('Missing production JavaScript');
  const stub = installFoundry(14);
  const globals = globalThis as any;
  const sockets: TestSocket[] = [];
  const pagehide: Array<() => void> = [];
  class TestSocket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: () => void;
    readyState = 0;
    sent: any[] = [];
    constructor() {
      sockets.push(this);
    }
    send(data: string) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.readyState = 3;
    }
    receive(message: object) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  try {
    const user = { id: 'player', name: 'Player', role: 1, isGM: false };
    Object.assign(globals.game, {
      user,
      world: { id: 'bundle-world', title: 'Bundle World' },
      system: { id: 'test', version: '1' },
      version: '14.369',
      users: { get: () => user, contents: [user] },
    });
    await globals.game.settings.set('agent-gateway', 'gatewayUrl', 'ws://bundle-test');
    await globals.game.settings.set(
      'agent-gateway',
      'pairingCredential',
      JSON.stringify({ url: 'ws://bundle-test', token: 'fixture' }),
    );
    runInNewContext(chunk.code, {
      game: globals.game,
      Hooks: globals.Hooks,
      foundry: globals.foundry,
      CONST: globals.CONST,
      addEventListener: (event: string, fn: () => void) => {
        if (event === 'pagehide') pagehide.push(fn);
      },
      performance,
      WebSocket: TestSocket,
      TextEncoder,
      TextDecoder,
      crypto: globalThis.crypto,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      console: { log: () => {}, warn: () => {}, error: console.error },
    });
    stub.fire('init');
    stub.fire('setup');
    stub.fire('ready');
    sockets[0]!.readyState = 1;
    sockets[0]!.onopen?.();
    sockets[0]!.receive({
      type: 'welcome',
      gatewayVersion: '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
      connectionId: 'connection',
      agentId: 'agent',
    });
    sockets[0]!.receive({
      type: 'call',
      id: 'world-call',
      sessionId: 'session',
      tool: 'world_info',
      args: {},
    });
    await expect
      .poll(() => sockets[0]!.sent.find((message) => message.id === 'world-call'))
      .toBeDefined();
    const result = sockets[0]!.sent.find((message) => message.id === 'world-call');
    expect(result, JSON.stringify(result)).toMatchObject({
      type: 'result',
      ok: true,
      structured: { worldId: 'bundle-world', userName: 'Player', foundryGeneration: 14 },
    });
  } finally {
    // Trigger the real pagehide cleanup without introducing test sockets or timers into later tests.
    for (const stop of pagehide) stop();
    sockets[0]?.close();
    stub.uninstall();
  }
});
