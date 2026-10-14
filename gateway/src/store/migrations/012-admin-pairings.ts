/**
 * Operator-set trust flags (task 90). `pairings.admin` marks an admin GM's pairing; `invites.admin`
 * and `invites.gm` mark operator invites that skip the GM vouch; `invites.created_by` is NULL for
 * the operator (reserved for delegated invites). Existing rows get 0 and NULL: nobody is promoted.
 * Numbered 012 here; task 38 holds the previous number (renumber at merge if both land).
 */
export default `ALTER TABLE pairings ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN gm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invites ADD COLUMN created_by TEXT;`;
