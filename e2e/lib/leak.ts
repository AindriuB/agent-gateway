import type { LeakMatcher } from '../fixtures/manifest.js';

export class LeakError extends Error {}

export interface LeakSummary {
  results: number;
  strings: number;
  hits: number;
}

/** Scans the serialised JSON of every player result for strings a player must never see. */
export class LeakChecker {
  private results = 0;
  private hits = 0;

  constructor(private readonly matchers: readonly LeakMatcher[]) {}

  /** Throws a LeakError naming the tool, the arguments and the string on the first hit. */
  check(tool: string, args: unknown, result: unknown): void {
    this.results++;
    const haystack = JSON.stringify(result) ?? '';
    for (const m of this.matchers) {
      if (m.test(haystack)) {
        this.hits++;
        throw new LeakError(
          `leak: tool ${tool} with arguments ${JSON.stringify(args ?? {})} returned hidden string "${m.label}"`,
        );
      }
    }
  }

  summary(): LeakSummary {
    return { results: this.results, strings: this.matchers.length, hits: this.hits };
  }

  line(): string {
    const s = this.summary();
    return `leak check: ${s.results} results x ${s.strings} strings, ${s.hits} hits`;
  }
}
