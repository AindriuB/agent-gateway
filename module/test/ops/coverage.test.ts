import { TOOLS } from '@agent-gateway/protocol';
import { describe, expect, it } from 'vitest';
import { HANDLERS } from '../../src/tools/index.js';

describe('handler coverage', () => {
  it('every module-handled tool has a handler', () => {
    const missing = TOOLS.filter((t) => t.handledBy === 'module' && !(t.name in HANDLERS)).map(
      (t) => t.name,
    );
    expect(missing).toEqual([]);
  });
  it('no handler exists for an unknown tool', () => {
    const known = new Set(TOOLS.map((t) => t.name));
    expect(Object.keys(HANDLERS).filter((n) => !known.has(n))).toEqual([]);
  });
});
