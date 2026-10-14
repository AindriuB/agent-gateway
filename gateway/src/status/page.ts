export interface StatusView {
  version: string;
  uptimeMs: number;
  worlds: readonly { worldId: string; userName: string; userId: string }[];
  /** Version and uptime only: for a request that is not authenticated on a public gateway. */
  minimal?: boolean;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

const MAX_ROWS = 200;

/** Minimal status page: version, connected worlds and users, uptime. No credentials. */
export function renderStatus(view: StatusView): string {
  const rows = view.worlds
    .slice(0, MAX_ROWS)
    .map((w) => `<li>${escapeHtml(w.userName || w.userId)} in ${escapeHtml(w.worldId)}</li>`)
    .join('');
  const more =
    view.worlds.length > MAX_ROWS ? `<p>and ${view.worlds.length - MAX_ROWS} more</p>` : '';
  const secs = Math.floor(view.uptimeMs / 1000);
  if (view.minimal)
    return (
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agent Gateway</title></head><body>' +
      `<h1>Agent Gateway</h1><p>Version: ${escapeHtml(view.version)}</p><p>Uptime: ${secs} s</p></body></html>`
    );
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Agent Gateway</title></head><body>' +
    `<h1>Agent Gateway</h1><p>Version: ${escapeHtml(view.version)}</p><p>Uptime: ${secs} s</p>` +
    `<h2>Connected (${view.worlds.length})</h2><ul>${rows}</ul>${more}</body></html>`
  );
}
