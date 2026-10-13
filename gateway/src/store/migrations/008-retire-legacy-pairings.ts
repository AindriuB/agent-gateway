/**
 * Pairings made before 007 have no origin and are refused at hello ("pairing predates origin
 * binding"), yet still counted as binding candidates. Revoke them; the rows are kept for audit.
 */
export default `UPDATE pairings
SET revoked_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE origin IS NULL AND revoked_at IS NULL`;
