import { escapeHtml } from '../../status/page.js';
import type { Scope } from '../repository.js';
import { ASCEND_MARK, GITHUB_MARK } from './marks.js';
import { CONSENT_STYLE_PATH } from './style.js';

/** The CSRF cookie is `<prefix><request id>`. Named in the footer so the two cannot drift. */
export const COOKIE_PREFIX = '__Host-agcsrf-';

/** Operator-set footer links (already validated by config). Unset means no link. */
export interface FooterLinks {
  privacyUrl?: string;
  sourceUrl?: string;
}

/**
 * Security headers on every consent response, JSON errors included. `same-origin`, not
 * `no-referrer`: under `no-referrer` Chrome sends `Origin: null` on the same-origin consent POST,
 * which the strict CSRF Origin check would refuse.
 */
export const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'cache-control': 'no-store',
  pragma: 'no-cache',
} as const;

/**
 * No external assets, no inline script. A response that can lead to the 302 to the client names
 * that request's registered redirect origin in `form-action`, because Chrome checks `form-action`
 * on every redirect hop.
 */
export const consentCsp = (redirectOrigin?: string): string =>
  `default-src 'none'; style-src 'self'; form-action 'self'${redirectOrigin ? ` ${redirectOrigin}` : ''}; frame-ancestors 'none'; base-uri 'none'`;

export const consentHeaders = (redirectOrigin?: string) =>
  ({
    ...SECURITY_HEADERS,
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': consentCsp(redirectOrigin),
  }) as Record<string, string>;

/** Headers for a JSON error on a consent route. */
export const consentJsonSecurity = (): Record<string, string> => ({
  ...SECURITY_HEADERS,
  'content-security-policy': consentCsp(),
});

/** The same text for a connected, an offline and an unknown user. */
export const CODE_SENT_TEXT =
  'If that user is online in that world, a code was sent to their Foundry window.';

const footer = (l: FooterLinks): string => {
  const rel = 'rel="noopener noreferrer"';
  const privacy = l.privacyUrl
    ? `<p><a href="${escapeHtml(l.privacyUrl)}" ${rel}>Privacy</a></p>`
    : '';
  const source = l.sourceUrl
    ? `<p><a href="${escapeHtml(l.sourceUrl)}" ${rel} aria-label="Source code on GitHub">${GITHUB_MARK}<span>Source code</span></a></p>`
    : '';
  return `<footer>${privacy}<p>This page sets one strictly necessary cookie, <code>${COOKIE_PREFIX}</code> followed by a request id. It is for sign-in only, is not used for tracking, and expires in 15 minutes.</p>${source}</footer>`;
};

const shell = (title: string, body: string, links: FooterLinks): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="${CONSENT_STYLE_PATH}"></head><body><main><h1>${escapeHtml(title)}</h1>${body}</main>${footer(links)}</body></html>`;

const hidden = (name: string, value: string): string =>
  `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;

export interface FormView {
  rid: string;
  csrf: string;
  clientName: string;
  scopes: readonly Scope[];
  links: FooterLinks;
  /** A fixed notice (never typed text). */
  notice?: string;
}

/** Step 1: name the world and the Foundry user, pick scopes. */
export function renderRequestPage(v: FormView): string {
  const boxes = v.scopes
    .map(
      (s) =>
        `<label><input type="checkbox" name="scope" value="${s}" checked> ${escapeHtml(s)}</label>`,
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
    v.links,
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
    v.links,
  );
}

export function renderMessagePage(title: string, message: string, links: FooterLinks): string {
  return shell(title, `<p>${escapeHtml(message)}</p>`, links);
}
