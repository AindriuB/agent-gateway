import { z } from 'zod';
import { ErrorCode } from './errors.js';

export const MAX_FRAME_BYTES = 1024 * 1024;

export const HelloMessage = z.strictObject({
  type: z.literal('hello'),
  protocolVersion: z.string(),
  moduleVersion: z.string(),
  foundryVersion: z.string(),
  world: z.strictObject({
    id: z.string(),
    title: z.string(),
    system: z.string(),
    systemVersion: z.string(),
  }),
  user: z.strictObject({
    id: z.string(),
    name: z.string(),
    role: z.number().int(),
    isGM: z.boolean(),
  }),
  auth: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('pairingCode'), code: z.string() }),
    z.strictObject({ kind: z.literal('pairingToken'), token: z.string() }),
  ]),
});

export const WelcomeMessage = z.strictObject({
  type: z.literal('welcome'),
  gatewayVersion: z.string(),
  protocolVersion: z.string(),
  connectionId: z.string(),
  agentId: z.string(),
  pairingToken: z.string().optional(),
});

export const RejectMessage = z.strictObject({
  type: z.literal('reject'),
  code: ErrorCode,
  message: z.string(),
});

export const CallMessage = z.strictObject({
  type: z.literal('call'),
  id: z.string(),
  sessionId: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
});

export const ResultMessage = z.strictObject({
  type: z.literal('result'),
  id: z.string(),
  ok: z.literal(true),
  text: z.string(),
  structured: z.unknown().optional(),
});

export const ErrorMessage = z.strictObject({
  type: z.literal('error'),
  id: z.string(),
  code: ErrorCode,
  message: z.string(),
});

export const PingMessage = z.strictObject({ type: z.literal('ping') });
export const PongMessage = z.strictObject({ type: z.literal('pong') });

// Insertion-only: later tasks add schemas above and members below.
export const LinkMessage = z.discriminatedUnion('type', [
  HelloMessage,
  WelcomeMessage,
  RejectMessage,
  CallMessage,
  ResultMessage,
  ErrorMessage,
  PingMessage,
  PongMessage,
]);
export type LinkMessage = z.infer<typeof LinkMessage>;

export type ParseResult =
  | { ok: true; message: LinkMessage }
  | { ok: false; reason: 'oversize' | 'malformed' | 'invalid'; message: string };

export function parseLinkMessage(raw: string | Uint8Array): ParseResult {
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw).byteLength : raw.byteLength;
  if (bytes > MAX_FRAME_BYTES) {
    return {
      ok: false,
      reason: 'oversize',
      message: `Frame of ${bytes} bytes exceeds limit ${MAX_FRAME_BYTES}`,
    };
  }
  const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed', message: 'Frame is not valid JSON' };
  }
  const parsed = LinkMessage.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid', message: parsed.error.message };
  }
  return { ok: true, message: parsed.data };
}
