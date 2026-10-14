import { escapeHtml } from '../../status/page.js';
import type { Scope } from '../repository.js';

/** Every consent response, errors included, carries these. There is no inline script and no asset. */
export const CONSENT_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

/** The same text for a connected, an offline and an unknown user. */
export const CODE_SENT_TEXT =
  'If that user is online in that world, a code was sent to their Foundry window.';

const shell = (title: string, body: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main></body></html>`;

const hidden = (name: string, value: string): string =>
  `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

export interface FormView {
  rid: string;
  csrf: string;
  clientName: string;
  scopes: readonly Scope[];
  /** A fixed notice (never typed text). */
  notice?: string;
}

/** Step 1: name the world and the Foundry user, pick scopes. */
export function renderRequestPage(v: FormView): string {
  const boxes = v.scopes
    .map(
      (s) =>
        `<label><input type="checkbox" name="scope" value="${s}" checked> ${escapeHtml(s)}</label><br>`,
    )
    .join('');
  return shell(
    'Authorize access to Foundry',
    `${v.notice ? `<p role="alert">${escapeHtml(v.notice)}</p>` : ''}` +
      `<p><strong>${escapeHtml(v.clientName || 'An application')}</strong> wants to use your Foundry character through an AI agent.</p>` +
      `<form method="post" action="/authorize/consent" autocomplete="off">${hidden('rid', v.rid)}${hidden('csrf', v.csrf)}${hidden('action', 'send')}` +
      `<p><label>World id <input name="world" required maxlength="200"></label></p>` +
      `<p><label>Foundry user (name or id) <input name="user" required maxlength="200"></label></p>` +
      `<fieldset><legend>Allow</legend>${boxes}</fieldset>` +
      `<p><button type="submit">Send a code to that user</button></p></form>`,
  );
}

/** Step 2: the code field. Shows no typed text, so it is identical whoever was named. */
export function renderCodePage(v: FormView): string {
  return shell(
    'Enter the code',
    `<p>${escapeHtml(CODE_SENT_TEXT)}</p>` +
      `${v.notice ? `<p role="alert">${escapeHtml(v.notice)}</p>` : ''}` +
      `<form method="post" action="/authorize/consent" autocomplete="off">${hidden('rid', v.rid)}${hidden('csrf', v.csrf)}${hidden('action', 'verify')}` +
      `<p><label>Code <input name="code" required maxlength="32" inputmode="numeric"></label></p>` +
      `<p><button type="submit">Approve</button></p></form>`,
  );
}

export function renderMessagePage(title: string, message: string): string {
  return shell(title, `<p>${escapeHtml(message)}</p>`);
}
