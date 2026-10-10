import { TOOLS } from '@agent-gateway/protocol';
import { describe, expect, it } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { HANDLERS } from '../../src/tools/index.js';

describe('undo is not a tool', () => {
  it('no TOOLS entry name contains "undo"', () => {
    expect(TOOLS.filter((t) => /undo/i.test(t.name)).map((t) => t.name)).toEqual([]);
  });
  it('no handler is registered under an undo or audit name', () => {
    expect(Object.keys(HANDLERS).filter((n) => /undo|audit|restore|revert/i.test(n))).toEqual([]);
  });
  it('an agent calling an undo tool by name gets TOOL_NOT_FOUND', async () => {
    const agent = { id: 'a', ownerUserId: 'u', headless: false };
    for (const tool of ['undo', 'audit_undo', 'undo_entry', 'audit_log']) {
      const r = await dispatch({ tool, args: {}, agent, sessionId: 's' }, { id: 'u', isGM: true });
      expect(r).toMatchObject({ error: { code: 'TOOL_NOT_FOUND' } });
    }
  });
});
