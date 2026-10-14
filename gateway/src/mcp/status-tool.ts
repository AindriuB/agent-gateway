export const STATUS_TOOL = 'gateway_status';

export type GatewayState = 'connected' | 'not_connected' | 'ambiguous';

export interface GatewayStatus {
  state: GatewayState;
  world?: string;
  user?: string;
  /** Only when `state` is `not_connected`. */
  pairingCode?: string;
  codeExpiresInMin?: number;
  candidates?: string[];
}

export const statusToolListing = {
  name: STATUS_TOOL,
  description:
    'Reports whether this session is connected to Foundry. When it is not, says how to pair: the pairing code to enter in the Agent Gateway pairing prompt in the browser when this gateway offers one, otherwise ask the gateway operator for a code. Never goes to Foundry.',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object' as const,
    properties: {
      state: { type: 'string', enum: ['connected', 'not_connected', 'ambiguous'] },
      world: { type: 'string' },
      user: { type: 'string' },
      pairingCode: { type: 'string' },
      codeExpiresInMin: { type: 'number' },
      candidates: { type: 'array', items: { type: 'string' } },
    },
    required: ['state'],
    additionalProperties: false,
  },
};

export const ASK_OPERATOR =
  'Ask the gateway operator for a pairing code, then open your world in a browser and enter it in the Agent Gateway pairing prompt.';

/** `askOperator`: this gateway never shows a pairing code to an MCP client. */
export function statusText(s: GatewayStatus, askOperator = false): string {
  const who = s.world !== undefined ? `world ${s.world} / user ${s.user}` : '';
  switch (s.state) {
    case 'connected':
      return `Connected to Foundry: ${who}.`;
    case 'ambiguous':
      return `Several Foundry users are connected and none is chosen. Available: ${(s.candidates ?? []).join('; ')}. Start the gateway with --world and --user to choose one.`;
    default:
      return `${who ? `Not connected: ${who} is offline. ` : 'Not connected to Foundry yet. '}${
        s.pairingCode
          ? `Open your world in a browser and enter code ${s.pairingCode} in the Agent Gateway pairing prompt (expires in ${s.codeExpiresInMin} min).`
          : askOperator
            ? ASK_OPERATOR
            : 'Open your world in a browser.'
      }`;
  }
}
