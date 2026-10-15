// OAuth client for scripts/conformance.sh: registers, authorizes through the consent page and
// exchanges the code, then prints the access token on stdout (nothing else).
//   node oauth-flow.mjs <publicUrl> <codeFile> <world> <user>
// The consent code is delivered to the fake module (task 67), which writes it to <codeFile>.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [base, codeFile, world, user] = process.argv.slice(2);
const origin = new URL(base).origin;
const redirect = 'http://127.0.0.1:6274/oauth/callback';
const fail = (msg) => {
  process.stderr.write(`oauth-flow: ${msg}\n`);
  process.exit(1);
};
const form = (o) => new URLSearchParams(o).toString();
const hiddenValue = (html, name) =>
  new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? fail(`page has no ${name} field`);

const reg = await fetch(`${origin}/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'conformance',
    redirect_uris: [redirect],
    token_endpoint_auth_method: 'none',
  }),
});
if (reg.status !== 201) fail(`register returned ${reg.status}`);
const { client_id: clientId } = await reg.json();

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(8).toString('hex');
const authUrl = `${origin}/authorize?${form({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirect,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  scope: 'read',
  state,
  resource: `${origin}/mcp`,
})}`;
const page = await fetch(authUrl, { redirect: 'manual' });
if (page.status !== 200) fail(`authorize returned ${page.status}`);
const html = await page.text();
const rid = hiddenValue(html, 'rid');
const csrf = hiddenValue(html, 'csrf');
const cookie = `__Host-agcsrf-${rid}=${csrf}`;

const consent = (fields) =>
  fetch(`${origin}/authorize/consent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie },
    body: form({ rid, csrf, ...fields }),
  });

const sent = await consent({ action: 'send', world, user, scope: 'read' });
if (sent.status !== 200) fail(`consent send returned ${sent.status}`);
for (let i = 0; i < 100 && !existsSync(codeFile); i++) await sleep(50);
if (!existsSync(codeFile)) fail('the fake module never received the consent code');
const code = readFileSync(codeFile, 'utf8');

const verified = await consent({ action: 'verify', code });
if (verified.status !== 302) fail(`consent verify returned ${verified.status}`);
const back = new URL(verified.headers.get('location') ?? fail('no redirect location'));
if (back.searchParams.get('state') !== state) fail('state did not round-trip');
const authCode =
  back.searchParams.get('code') ?? fail(`no code (error=${back.searchParams.get('error')})`);

const tok = await fetch(`${origin}/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: form({
    grant_type: 'authorization_code',
    client_id: clientId,
    code: authCode,
    code_verifier: verifier,
    redirect_uri: redirect,
    resource: `${origin}/mcp`,
  }),
});
if (tok.status !== 200) fail(`token returned ${tok.status}`);
const { access_token: access } = await tok.json();
if (!access) fail('token response has no access_token');
process.stdout.write(access);
