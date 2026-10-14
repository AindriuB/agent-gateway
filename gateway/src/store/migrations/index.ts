import m001 from './001-pairings.js';
import m002 from './002-pairing-user-name.js';
import m003 from './003-events.js';
import m006 from './006-queued-result-failed.js';
import m005 from './005-offline-queue.js';
import m004 from './004-event-policy.js';
import m007 from './007-pairing-origin.js';
import m008 from './008-retire-legacy-pairings.js';
import m009 from './009-gateway-settings.js';
import m010 from './010-oauth.js';

/**
 * Ordered, insertion-only registry. Each task adds one static import and one
 * array entry. Static imports keep this bundle-safe: no directory scan.
 */
export const MIGRATIONS: readonly string[] = [
  m001,
  m002,
  m003,
  m004,
  m005,
  m006,
  m007,
  m008,
  m009,
  m010,
];
