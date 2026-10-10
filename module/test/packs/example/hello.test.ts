import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkToolDefinition } from '@agent-gateway/protocol';
import { createPackApi, PackError } from '../../../src/packs/api.js';
import { createRegistryDispatcher } from '../../../src/ops/dispatch.js';
import { ToolRegistry, type RegistryLookup } from '../../../src/ops/registry-class.js';
import { createPolicyStage } from '../../../src/policy/stage.js';
import { DEFAULT_WORLD_MATRIX, DEFAULT_OWNER_MATRIX } from '../../../src/policy/matrix.js';
import type { Stage } from '../../../src/ops/stages.js';

vi.hoisted(() => {
  vi.stubGlobal('Hooks', { on: vi.fn(), once: vi.fn() });
});

// Plain JavaScript is the actual distributable, with no build step.
// @ts-expect-error example is deliberately plain ESM JavaScript
import { registerHelloPack, journalStamp } from '../../../../examples/hello-pack/scripts/main.js';

const call = (tool: string, args: unknown) => ({
  tool,
  args,
  agent: { id: 'agent', ownerUserId: 'owner', headless: false },
  sessionId: 'session',
});
const user = { id: 'owner', isGM: false };
function rig(active = true, stages: Stage[] = []) {
  let lookup!: RegistryLookup;
  const registry = new ToolRegistry((value) => {
    lookup = value;
  });
  const modules = new Map([['agent-gateway-hello-pack', { active }]]);
  vi.stubGlobal('game', { modules, users: new Map([['owner', user]]) });
  const { api } = createPackApi(registry, {
    active: (id) => modules.get(id)?.active === true,
    translate: (key) => key,
  });
  return { api, registry, dispatch: createRegistryDispatcher(registry, lookup, stages) };
}
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('distributable Hello Pack', () => {
  it('registers valid definitions and computes 2d6 >= 7 through the dispatcher', async () => {
    const { api, registry, dispatch } = rig();
    registerHelloPack(api);
    expect(registry.list().map((t) => t.name)).toEqual(['hello-dice_odds', 'hello-journal_stamp']);
    for (const definition of registry.list()) {
      expect(
        checkToolDefinition(
          {
            ...definition,
            pack: { id: 'agent-gateway-hello-pack', version: '0.1.0', prefix: 'hello' },
          },
          'pack',
        ),
      ).toEqual([]);
    }
    const result = await dispatch(call('hello-dice_odds', { count: 2, sides: 6, target: 7 }), user);
    expect(result.structured?.probability).toBeCloseTo(21 / 36, 6);
    expect(
      await dispatch(call('hello-dice_odds', { count: 21, sides: 6, target: 7 }), user),
    ).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(
      await dispatch(call('hello-dice_odds', { count: 20, sides: 100, target: 2001 }), user),
    ).toMatchObject({ structured: { probability: 0 } });
  });
  it('reaches owner approval under default policy without running the journal handler', async () => {
    const approval = vi.fn(async (ctx) => {
      expect(ctx.approval).toEqual({ approver: 'owner' });
      return { error: { code: 'DENIED' as const, message: 'Awaiting owner' } };
    });
    const policy = createPolicyStage({
      inputs: () => ({
        world: DEFAULT_WORLD_MATRIX,
        owner: DEFAULT_OWNER_MATRIX,
        playerAgentsEnabled: true,
        headlessAgentsEnabled: false,
      }),
      tools: [{ name: 'hello-journal_stamp', category: 'write' }] as never,
    });
    const { api, dispatch } = rig(true, [policy, { name: 'approval', order: 30, run: approval }]);
    registerHelloPack(api);
    await dispatch(
      call('hello-journal_stamp', { pageUuid: 'JournalEntry.j.JournalEntryPage.p', line: 'hi' }),
      user,
    );
    expect(approval).toHaveBeenCalledOnce();
  });
  it('refuses an inactive module atomically', () => {
    const { api, registry } = rig(false);
    expect(() => registerHelloPack(api)).toThrow(PackError);
    expect(registry.list()).toEqual([]);
  });
  it('documents every public PackError code', () => {
    const source = readFileSync(new URL('../../../src/packs/api.ts', import.meta.url), 'utf8');
    const union = source.split('export type PackErrorCode =')[1]!.split(';')[0]!;
    const docs = readFileSync(new URL('../../../../docs/packs/api.md', import.meta.url), 'utf8');
    for (const [, code] of union.matchAll(/'([A-Z_]+)'/g)) expect(docs).toContain(code);
  });
});

describe('journal mutation contract', () => {
  function setup() {
    rig();
    const journal = {
      documentName: 'JournalEntry',
      flags: {},
      testUserPermission: vi.fn(() => true),
    };
    const page = {
      documentName: 'JournalEntryPage',
      parent: journal,
      type: 'text',
      flags: {},
      text: { format: 1, content: '<p>Existing</p>' },
      testUserPermission: vi.fn(() => true),
      update: vi.fn(async () => {}),
    };
    vi.stubGlobal(
      'fromUuid',
      vi.fn(async () => page),
    );
    const ctx = {
      user,
      args: { pageUuid: 'JournalEntry.j.JournalEntryPage.p', line: '<script>"x" & \'y\'</script>' },
      snapshot: vi.fn(async () => {}),
      callOptions: { agentGateway: { callId: 'call' } },
    };
    return { journal, page, ctx };
  }
  it.each(['journal', 'page'])(
    'refuses non-owner of %s without snapshot or update',
    async (which) => {
      const { journal, page, ctx } = setup();
      (which === 'journal' ? journal : page).testUserPermission.mockReturnValue(false);
      expect(await journalStamp(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(ctx.snapshot).not.toHaveBeenCalled();
      expect(page.update).not.toHaveBeenCalled();
    },
  );
  it.each(['audit', 'nontext', 'markdown', 'missing-snapshot'])(
    'refuses unsafe target %s',
    async (kind) => {
      const { journal, page, ctx } = setup();
      if (kind === 'audit')
        Object.assign(journal.flags, { 'agent-gateway': { auditJournal: true } });
      if (kind === 'nontext') page.type = 'image';
      if (kind === 'markdown') page.text.format = 2;
      if (kind === 'missing-snapshot') Object.assign(ctx, { snapshot: undefined });
      expect(await journalStamp(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
      expect(page.update).not.toHaveBeenCalled();
    },
  );
  it('awaits snapshot, escapes appended HTML, and passes callOptions unchanged', async () => {
    const { page, ctx } = setup();
    let finish!: () => void;
    ctx.snapshot.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = journalStamp(ctx);
    await vi.waitFor(() => expect(ctx.snapshot).toHaveBeenCalledWith(ctx.args.pageUuid));
    expect(page.update).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(page.update.mock.calls[0]?.[1]).toBe(ctx.callOptions);
    const update = page.update.mock.calls[0]?.[0] as unknown as Record<string, string>;
    expect(update['text.content']).toContain(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
    expect(update['text.content']).not.toContain('<script>');
    expect(page.testUserPermission).toHaveBeenCalledWith(user, 'OWNER');
  });
  it('does not update if the snapshot fails', async () => {
    const { page, ctx } = setup();
    ctx.snapshot.mockRejectedValue(new Error('snapshot failed'));
    await expect(journalStamp(ctx)).rejects.toThrow('snapshot failed');
    expect(page.update).not.toHaveBeenCalled();
  });
});
