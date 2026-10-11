/** MCP-only result envelope; canonical module schemas remain unchanged. */
export function projectOutputSchema(normal: Record<string, unknown>): {
  type: 'object';
  anyOf: Record<string, unknown>[];
} {
  return {
    type: 'object',
    anyOf: [
      structuredClone(normal),
      {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending_approval'] },
          id: { type: 'string', minLength: 1, maxLength: 100 },
        },
        required: ['status', 'id'],
        additionalProperties: false,
      },
    ],
  };
}
