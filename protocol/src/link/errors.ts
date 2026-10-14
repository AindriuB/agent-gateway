import { z } from 'zod';

export const ErrorCode = z.enum([
  'WORLD_OFFLINE',
  'PROTOCOL_MAJOR_MISMATCH',
  'PAIRING_INVALID',
  'TOOL_NOT_FOUND',
  'FORBIDDEN',
  'INVALID_ARGS',
  'RATE_LIMITED',
  'DENIED',
  'INTERNAL',
  'PAIRING_UNCONFIRMED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
