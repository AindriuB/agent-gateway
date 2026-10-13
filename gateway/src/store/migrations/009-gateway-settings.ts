/** Small key/value settings owned by the gateway itself (the hash of the HTTP bearer token). */
export default `CREATE TABLE gateway_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;
