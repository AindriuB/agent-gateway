/**
 * The consent pages' stylesheet. It is served same-origin (the CSP's `style-src 'self'` forbids
 * inline styles) and is static, so every user gets the same bytes. Palette, themes, type stacks,
 * spacing and radii are copied in as plain values; nothing is imported at build or run time and
 * no font or image is loaded. The footer's two inline SVG marks live in marks.ts, not here.
 */
export const CONSENT_STYLE_PATH = '/authorize/consent.css';

export const CONSENT_CSS = `:root {
  color-scheme: light;
  --font-sans: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --reading-max: 42rem;
  --radius-control: 8px;
  --radius-card: 16px;
  --motion: 120ms;
  --background: #F8FAFC;
  --surface: #FFFFFF;
  --surface-raised: #F1F5F9;
  --text: #1E293B;
  --text-muted: #475569;
  --border: #E2E8F0;
  --control-border: #64748B;
  --action: #475569;
  --action-hover: #334155;
  --on-action: #FFFFFF;
  --focus: #475569;
  --danger: #B91C1C;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --background: #0B1220;
    --surface: #0F172A;
    --surface-raised: #1E293B;
    --text: #F8FAFC;
    --text-muted: #94A3B8;
    --border: #334155;
    --control-border: #94A3B8;
    --action: #86EFAC;
    --action-hover: #BBF7D0;
    --on-action: #0B1220;
    --focus: #86EFAC;
    --danger: #FCA5A5;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 2rem 1rem;
  background: var(--background);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.5;
}
main {
  max-width: var(--reading-max);
  margin: 0 auto;
  padding: 1.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
}
h1 { margin: 0 0 1rem; font-size: 1.5rem; line-height: 1.3; font-weight: 600; }
p { margin: 0 0 1rem; }
[role="alert"] { color: var(--danger); font-weight: 500; }
label { font-size: 0.875rem; font-weight: 500; }
input[type="text"], input:not([type]) {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.5rem 0.75rem;
  font: inherit;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--control-border);
  border-radius: var(--radius-control);
}
fieldset {
  margin: 0 0 1rem;
  padding: 0.75rem 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
}
legend { padding: 0 0.25rem; font-size: 0.875rem; font-weight: 500; color: var(--text-muted); }
fieldset label { display: block; padding: 0.25rem 0; font-size: 1rem; font-weight: 400; }
input[type="checkbox"] { accent-color: var(--action); margin-right: 0.5rem; }
button {
  padding: 0.5rem 1rem;
  font: inherit;
  font-weight: 600;
  color: var(--on-action);
  background: var(--action);
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  cursor: pointer;
  transition: background-color var(--motion) cubic-bezier(0.2, 0, 0, 1);
}
button:hover { background: var(--action-hover); }
footer {
  max-width: var(--reading-max);
  margin: 1rem auto 0;
  padding: 0 1.5rem;
  font-size: 0.875rem;
  color: var(--text-muted);
}
footer p { margin: 0 0 0.5rem; }
footer a { color: var(--text-muted); text-decoration: underline; }
footer a:hover { color: var(--text); }
footer a[aria-label] { display: inline-flex; align-items: center; gap: 0.5rem; }
.mark { width: 1.125rem; height: 1.125rem; flex: none; }
.mark + .mark { margin-left: 0.25rem; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  :root { --motion: 0ms; }
  * { transition: none !important; animation: none !important; }
}
`;
