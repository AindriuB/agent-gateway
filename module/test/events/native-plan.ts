/** Pure Task27 acceptance plan; importing it performs no native actions. */
import { AgentEvent, parseLinkMessage } from '@agent-gateway/protocol';
import { WebSocket } from 'ws';
const SOURCE = '0a5835b137527398eb5b5bdb7ceead40575a1b70';
const BUNDLE = '80625451b6db75f19c2b95c0a6c6b158fb16d8e69f80d46d1b35b03c45a041ad';
export function task27Pins(source = SOURCE, bundle = BUNDLE) {
  if (!/^[a-f0-9]{40}$/.test(source) || !/^[a-f0-9]{64}$/.test(bundle))
    throw Error('Reviewed Task27 source and bundle pins required');
  return { source, bundle };
}
export function task27Plan(run: string, generation: 13 | 14) {
  if (!/^[a-f0-9]{12}$/.test(run)) throw Error('Exact bounded fixture nonce required');
  const prefix = `Task27-${run}`;
  return {
    prefix,
    fixtureCount: generation === 14 ? 8 : 7,
    actor: {
      name: `${prefix}-NPC`,
      type: 'npc',
      ownership: { default: 2 },
      items: [],
      effects: [],
      flags: { world: { task27: run } },
    },
    scene: {
      name: `${prefix}-Scene`,
      navName: `${prefix}-View`,
      active: false,
      navigation: false,
      width: 1000,
      height: 1000,
      padding: 0,
      tokenVision: false,
      grid: { size: 100, type: 1 },
      ownership: { default: 2 },
      flags: { world: { task27: run } },
      ...(generation === 14
        ? {
            initialLevel: 'task27ground0001',
            levels: [
              {
                _id: 'task27ground0001',
                name: `${prefix}-Level`,
                elevation: { bottom: 0, top: 10 },
              },
            ],
          }
        : {}),
    },
    tokens: [
      { name: `${prefix}-Visible`, x: 100, y: 100, hidden: false },
      { name: `${prefix}-Hidden`, x: 400, y: 100, hidden: true },
    ],
    publicCall: { tool: 'chat_post', args: { content: `${prefix} public agent message` } },
    whisper: `${prefix} private whisper body`,
    blind: `${prefix} private blind body`,
    actorNames: ['first', 'coalesced', 'dropped', 'reconnected'].map(
      (phase) => `${prefix}-${phase}`,
    ),
    tokenNames: [`${prefix}-Visible-confirmed`, `${prefix}-Hidden-confirmed`],
  };
}
export type ObservedFrame = { connection: string; receivedAt: number; event: unknown };
/** Checks the actual passive socket capture, including every connection's first emitted sequence. */
export function assertTask27Sequence(frames: ObservedFrame[]) {
  const last = new Map<string, number>();
  for (const frame of frames) {
    const event = AgentEvent.parse(frame.event),
      previous = last.get(frame.connection);
    if (previous === undefined ? event.seq !== 1 : event.seq <= previous)
      throw Error('Event connection sequence mismatch');
    last.set(frame.connection, event.seq);
  }
}
/** No private document reference or body may cross an observer's captured socket. */
export function assertTask27Privacy(frames: ObservedFrame[], forbidden: string[], userId: string) {
  for (const frame of frames) {
    const event = AgentEvent.parse(frame.event),
      serialized = JSON.stringify(event);
    if (event.userId !== userId || forbidden.some((secret) => serialized.includes(secret)))
      throw Error('Event observer or privacy mismatch');
  }
}

/** Known link traffic must never disappear from the proof sensor on parse/size failure. */
export function task27CapturedFrame(raw: string | Uint8Array) {
  const parsed = parseLinkMessage(raw);
  if (!parsed.ok) throw Error('Invalid or oversized captured native link frame');
  const message = parsed.message;
  if (message.type === 'event') return { event: message.event };
  if (message.type === 'welcome')
    return { welcome: { id: message.connectionId, protocolVersion: message.protocolVersion } };
  return {};
}

/** Fixture-only access to this executor's server: capture GM before other peers open. */
export function task27OwnedSocket(server: object): WebSocket {
  const value = Object.getOwnPropertyDescriptor(server, 'sockets')?.value;
  if (!(value instanceof Set) || value.size !== 1)
    throw Error('Exactly one executor-owned GM socket required');
  const socket = [...value][0];
  if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN)
    throw Error('Native GM transport unavailable');
  return socket;
}
/** A transport loss, not LinkConnection.close(), whose meaning is terminal replacement. */
export function task27DropSocket(
  server: object,
  socket: WebSocket,
  expected: { id: string; closed: boolean },
  current: { id: string; closed: boolean } | undefined,
): void {
  const value = Object.getOwnPropertyDescriptor(server, 'sockets')?.value;
  if (
    !(value instanceof Set) ||
    !value.has(socket) ||
    current !== expected ||
    expected.closed ||
    socket.readyState !== WebSocket.OPEN
  )
    throw Error('Exact authenticated GM socket custody changed');
  socket.terminate();
}
