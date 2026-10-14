import type { Scope } from './repository.js';

/** What the user is asked to approve at /authorize. */
export interface ConsentRequest {
  clientId: string;
  /** Registered, trimmed and printable only; still untrusted text. */
  clientName: string;
  redirectUri: string;
  scopes: Scope[];
  resource: string;
  state: string | undefined;
}

export type ConsentDecision =
  { approve: { worldId: string; userId: string; scopes: Scope[] } } | { deny: string };

/** The step between a valid /authorize request and a grant. 67 supplies the real one. */
export interface ConsentStep {
  decide(request: ConsentRequest): Promise<ConsentDecision>;
}

/** Placeholder until 67: every authorization is refused, so no grant can exist by default. */
export class AutoDenyConsent implements ConsentStep {
  decide(): Promise<ConsentDecision> {
    return Promise.resolve({ deny: 'consent is not available yet' });
  }
}
