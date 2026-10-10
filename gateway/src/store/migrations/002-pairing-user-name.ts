// The user's name as reported when the pairing code was redeemed. Binding by name reads this
// recorded value, never the name in a later `hello`.
export default `ALTER TABLE pairings ADD COLUMN user_name TEXT NOT NULL DEFAULT ''`;
