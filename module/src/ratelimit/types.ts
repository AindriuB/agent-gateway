// Declared here so `retryAfterSeconds` is typed without editing the shared ops types.
declare module '../ops/types.js' {
  interface OpError {
    /** Whole seconds, at least 1, until a RATE_LIMITED call would be admitted. */
    retryAfterSeconds?: number;
  }
}
export {};
