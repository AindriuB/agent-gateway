/**
 * Two marks, both rendered as decorative inline SVG in the consent-page footer.
 *
 * Ascend mark (ASCEND_PATH): (c) 2026 Andrew Bannister. All rights reserved. Not covered by this
 * repository's MIT licence. The monochrome silhouette only.
 *
 * GitHub mark (GITHUB_PATH): a trademark of GitHub, Inc., used unmodified under
 * https://github.com/logos (usage rules checked 2026-10-14).
 */
export const ASCEND_PATH =
  'M 29.6898 149.7853 L 101.6898 45.7853 A 32 32 0 0 1 154.3102 45.7853 L 226.3102 149.7853 A 32 32 0 0 1 173.6898 186.2147 L 128 120.2183 L 82.3102 186.2147 A 32 32 0 0 1 29.6898 149.7853 Z';

export const ASCEND_VIEWBOX = '0 0 256 256';

export const GITHUB_PATH =
  'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';

export const GITHUB_VIEWBOX = '0 0 16 16';

const svg = (viewBox: string, d: string): string =>
  `<svg class="mark" viewBox="${viewBox}" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;

export const GITHUB_MARK = svg(GITHUB_VIEWBOX, GITHUB_PATH);
export const ASCEND_MARK = svg(ASCEND_VIEWBOX, ASCEND_PATH);
