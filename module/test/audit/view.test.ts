/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { entryView } from '../../src/apps/audit/view.js';
import { confirmConflicts } from '../../src/apps/audit/index.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

const findTemplate = (): string =>
  fileURLToPath(new URL('../../../templates/audit/audit.hbs', import.meta.url));

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const EVIL = '<img src=x onerror=alert(1)>';

describe('audit app rendering', () => {
  it('prints every value with an escaping expression, never raw', () => {
    const hbs = readFileSync(findTemplate(), 'utf8');
    expect(hbs).not.toMatch(/\{\{\{|\{\{&|\|safe|triple/);
    expect(hbs).toContain('{{args}}');
  });

  it('reduces hostile stored text to bounded printable strings', () => {
    stub = installFoundry(14);
    (globalThis as any).game.users = { get: () => ({ name: `Pat‮${EVIL}` }) };
    (globalThis as any).game.system = { id: 'dnd5e' };
    const view = entryView({
      id: 'pg1',
      system: {
        tool: `tool\u0000${EVIL}`,
        category: 'write',
        status: EVIL,
        timestamp: 1000,
        userId: 'p1',
        agentId: `a\nb${EVIL}`,
        result: 'r'.repeat(10_000),
        args: `{"a":"${EVIL}"}${'x'.repeat(50_000)}`,
        targets: [
          {
            uuid: `Actor.${EVIL}`,
            existed: true,
            existsAfter: true,
            undoable: true,
            note: EVIL.repeat(100),
            before: JSON.stringify({
              name: EVIL,
              flags: { 'other-module': { secret: 'hidden-other-module-data' }, core: { a: 1 } },
            }),
          },
        ],
        undoneAt: null,
      },
    });
    expect(view.tool).not.toContain('\u0000');
    expect(view.user).not.toContain('‮');
    expect(view.agent).not.toContain('\n');
    expect(view.status).toBe('ok');
    expect(view.result.length).toBeLessThanOrEqual(503);
    expect(view.args.length).toBeLessThanOrEqual(4003);
    expect(view.targets[0]!.note.length).toBeLessThanOrEqual(123);
    // The snapshot is shown through the serialiser: other modules' flags are not.
    expect(view.targets[0]!.before).not.toContain('hidden-other-module-data');
    expect(view.targets[0]!.before).toContain('core');
    expect(view.canUndo).toBe(true);
    // Values stay plain strings: the template escapes them when printed.
    for (const v of [view.tool, view.agent, view.result, view.args])
      expect(typeof v).toBe('string');
  });

  it('shows an undone entry without an undo button', () => {
    stub = installFoundry(14);
    (globalThis as any).game.users = { get: () => undefined };
    expect(
      entryView({ id: 'p', system: { targets: [{ uuid: 'A.b', undoable: true }], undoneAt: 5 } }),
    ).toMatchObject({
      undone: true,
      canUndo: false,
    });
  });

  it('escapes document ids and text in the conflict dialog', async () => {
    stub = installFoundry(14);
    let content = '';
    (globalThis as any).game.i18n = { localize: (k: string) => `${k}<b>` };
    (globalThis as any).foundry.applications.api.DialogV2 = {
      confirm: async (cfg: any) => ((content = cfg.content), true),
    };
    expect(await confirmConflicts([{ uuid: `Actor.${EVIL}`, reason: 'modified' }])).toBe(true);
    expect(content).not.toContain('<img');
    expect(content).not.toContain('<b>');
    expect(content).toContain('&#60;img');
  });
});
