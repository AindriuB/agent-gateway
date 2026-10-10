// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatch } from '../../src/ops/dispatch.js';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';
import { codeField, fakeDoc, gmUser, htmlField, playerUser } from '../stubs/world.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

const uuid = 'Compendium.w.journals.JournalEntry.j1';

function run(flagged: boolean, user: any) {
  stub = installFoundry(14);
  const g = globalThis as any;
  g.game.system = { id: 'dnd5e' };
  stub.registeredSettings.set('agent-gateway.includeOtherModuleData', {
    name: '',
    scope: 'world',
    config: true,
    type: Boolean,
    default: false,
  });
  const users = [gmUser, playerUser];
  g.game.users = { get: (id: string) => users.find((u) => u.id === id) };
  g.foundry.data = {
    fields: { HTMLField: htmlField.constructor, JavaScriptField: codeField.constructor },
  };
  const pack = {
    collection: 'w.journals',
    documentName: 'JournalEntry',
    getIndex: vi.fn(async () => ({ contents: [] })),
    testUserPermission: () => true,
  };
  g.game.packs = {
    contents: [pack],
    get: (id: string) => (id === 'w.journals' ? pack : undefined),
  };
  const doc: any = fakeDoc({
    id: 'j1',
    name: 'Exported audit',
    uuid,
    documentName: 'JournalEntry',
    observers: ['gm1', 'p1'],
  });
  if (flagged) doc.flags = { 'agent-gateway': { auditJournal: true } };
  g.fromUuid = async () => doc;
  return dispatch(
    {
      tool: 'compendium_get',
      args: { uuid },
      agent: { id: 'a', ownerUserId: user.id, headless: false },
      sessionId: 's',
    },
    user,
  );
}

describe('compendium_get and the audit log', () => {
  it('refuses a GM-exported copy of the audit journal, for a GM too', async () => {
    for (const user of [gmUser, playerUser]) {
      expect(await run(true, user)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    }
  });

  it('control: the same entry unflagged is readable', async () => {
    expect(await run(false, gmUser)).toMatchObject({ structured: { name: 'Exported audit' } });
  });
});
