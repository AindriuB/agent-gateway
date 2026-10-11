/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { documentCreateHandler } from '../../../src/tools/document-create.js';
import { setup, g } from './fixtures.js';
let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => f.restore());

/** Native Document's inherited UI affordance builds an invalid blank strict sample.
 * Its instance permission method checks native parent OWNER on both generations.
 */
function nativeClass(type: string, generation: 13 | 14) {
  class NativeDocument {
    static documentName = type;
    static metadata = {
      permissions: { create: generation === 14 ? 'custom' : 'OWNER' },
      embedded: {},
    };
    static canUserCreate(user: any) {
      let sample;
      try {
        sample = this.fromSource({}, { strict: true });
      } catch {
        return false;
      }
      return sample.canUserModify(user, 'create', {});
    }
    static fromSource(data: any, options: any): NativeDocument {
      return new this(data, options);
    }
    documentName = type;
    parent: any;
    constructor(
      readonly data: any,
      options: any,
    ) {
      if (options.strict !== true || typeof data.name !== 'string' || data.name.trim().length === 0)
        throw new Error('Required nonblank name');
      expect(options.creation).toBe(true);
      this.parent = options.parent;
    }
    canUserModify(user: any, action: string, data: any) {
      if (action !== 'create' || data.name !== this.data.name) return false;
      return this.parent?.testUserPermission(user, 'OWNER') === true;
    }
  }
  class ConfiguredDocument extends NativeDocument {}
  // v14 ActiveEffect overrides the UI affordance, while its actual instance still requires parent OWNER.
  if (generation === 14 && type === 'ActiveEffect')
    ConfiguredDocument.canUserCreate = (user) => user.isGM;
  f.classes[type] = ConfiguredDocument;
  return ConfiguredDocument;
}
const cases = [
  [13, 'JournalEntryPage', 'JournalEntry'],
  [14, 'JournalEntryPage', 'JournalEntry'],
  [13, 'ActiveEffect', 'Actor'],
  [14, 'ActiveEffect', 'Actor'],
] as const;
it.each(cases)(
  'uses actual valid data and parent for v%i %s creation',
  async (version, type, parentType) => {
    const cls = nativeClass(type, version);
    const parent = f.doc(parentType);
    expect(cls.canUserCreate(f.gm)).toBe(version === 14 && type === 'ActiveEffect'); // Original handler would refuse this valid request.
    const args = {
      type,
      parentUuid: parent.uuid,
      data: JSON.stringify({
        name: 'Required name',
        ...(type === 'JournalEntryPage' ? { type: 'text' } : {}),
      }),
    };
    const ctx = f.ctx('document_create', args);
    expect(await documentCreateHandler(ctx)).toHaveProperty('structured.uuid');
    expect(parent.createEmbeddedDocuments).toHaveBeenCalledWith(
      type,
      [JSON.parse(args.data)],
      ctx.callOptions,
    );
    expect(ctx.intendCreate).toHaveBeenCalledBefore(parent.createEmbeddedDocuments);
    expect(ctx.created).toHaveBeenCalledWith(expect.stringContaining(`.${type}.`), parent);
  },
);
it.each(cases)(
  'refuses invalid required data on v%i %s before audit intent/mutation',
  async (version, type, parentType) => {
    nativeClass(type, version);
    const parent = f.doc(parentType);
    const args = { type, parentUuid: parent.uuid, data: '{}' };
    const ctx = f.ctx('document_create', args);
    expect(await documentCreateHandler(ctx)).toMatchObject({ error: { code: 'INVALID_ARGS' } });
    expect(ctx.intendCreate).not.toHaveBeenCalled();
    expect(ctx.created).not.toHaveBeenCalled();
    expect(parent.createEmbeddedDocuments).not.toHaveBeenCalled();
  },
);
it.each(['permission', 'demotion', 'parent', 'logout'])(
  'rechecks actual candidate and canonical parent after intent: %s',
  async (mode) => {
    nativeClass('JournalEntryPage', 14);
    const parent = f.doc('JournalEntry');
    const args = {
      type: 'JournalEntryPage',
      parentUuid: parent.uuid,
      data: '{"name":"Page","type":"text"}',
    };
    const ctx = f.ctx('document_create', args);
    ctx.intendCreate.mockImplementation(async () => {
      if (mode === 'permission') parent.allowed = false;
      if (mode === 'demotion') f.gm.isGM = false;
      if (mode === 'parent') f.collections.get('JournalEntry').set(parent.id, { ...parent });
      if (mode === 'logout') g.game.user = undefined;
    });
    expect(await documentCreateHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(parent.createEmbeddedDocuments).not.toHaveBeenCalled();
    expect(ctx.created).not.toHaveBeenCalled();
  },
);
it('does not replace actual native create denial with the GM role hint', async () => {
  const cls = nativeClass('ActiveEffect', 13);
  const parent = f.doc('Actor');
  vi.spyOn(cls.prototype, 'canUserModify').mockReturnValue(false);
  const args = { type: 'ActiveEffect', parentUuid: parent.uuid, data: '{"name":"Effect"}' };
  const ctx = f.ctx('document_create', args);
  expect(await documentCreateHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(ctx.intendCreate).not.toHaveBeenCalled();
  expect(parent.createEmbeddedDocuments).not.toHaveBeenCalled();
});

it('preserves native root class permission checks', async () => {
  f.classes.Actor.canUserCreate.mockReturnValue(false);
  const args = { type: 'Actor', data: '{"name":"Actor"}' };
  const ctx = f.ctx('document_create', args);
  expect(await documentCreateHandler(ctx)).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(f.classes.Actor.fromSource).not.toHaveBeenCalled();
  expect(ctx.intendCreate).not.toHaveBeenCalled();
  expect(f.mutations).toHaveLength(0);
});
