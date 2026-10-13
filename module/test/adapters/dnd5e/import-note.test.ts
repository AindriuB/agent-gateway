// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HANDLERS } from '../../../src/tools/index.js';
import { setup, g } from '../../tools/gm-documents/fixtures.js';

let f: ReturnType<typeof setup>;
let entry: any;
beforeEach(() => {
  f = setup();
  g.game.system = { id: 'dnd5e' };
  g.Hooks = { on: () => 1, off: () => {} };
  ({ entry } = f.pack('Item'));
});
afterEach(() => f.restore());
const run = async (source: any) => {
  entry.toObject = () => source;
  const actor = f.doc('Actor', { _id: 'a1', name: 'PC' });
  const args = { uuid: entry.uuid, actorUuid: actor.uuid };
  return (await HANDLERS['compendium_import']!(f.ctx('compendium_import', args))) as any;
};

describe('compendium_import into a dnd5e Actor', () => {
  it('says a class, subclass, species or background was embedded without its advancements', async () => {
    const result = await run({
      _id: 's',
      name: '<script>x</script>',
      type: 'class',
      system: { advancement: { a: {}, b: {} } },
      flags: {},
    });
    expect(result.text).toMatch(/NOT applied/);
    expect(result.text).not.toContain('<script>');
  });
  it('adds no note for an item without advancements', async () => {
    const result = await run({ _id: 's', name: 'Sword', type: 'weapon', system: {}, flags: {} });
    expect(result.text).not.toMatch(/NOT applied/);
  });
});
