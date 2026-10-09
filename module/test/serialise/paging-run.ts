import { documentToMarkdown, htmlToDocument, page } from '../../src/serialise/index.js';
import { checkDocument, type Pager } from './paging-oracle.js';

export const pager: Pager = (doc, cursor, limit) => page(doc, cursor, limit);
export const ALL_LIMITS = [...Array.from({ length: 200 }, (_, i) => i + 1), 1000, 8000];
export const SOME_LIMITS = [
  ...Array.from({ length: 30 }, (_, i) => i + 1),
  40,
  64,
  97,
  150,
  200,
  1000,
  8000,
];

export function run(cases: string[], limits: readonly number[]): string[] {
  const failures: string[] = [];
  for (const html of cases) {
    for (const f of checkDocument(html, limits, pager, htmlToDocument, documentToMarkdown)) {
      if (failures.length < 8) failures.push(f);
    }
  }
  return failures;
}

/** Every `step`th case, for the fast suite's sample of a slow corpus. */
export function sample<T>(cases: readonly T[], step: number): T[] {
  return cases.filter((_, i) => i % step === 0);
}

/** Representative limits for the fast suite: tiny, small, mid and the default/maximum sizes. */
export const FAST_LIMITS = [1, 8, 50, 1000];
