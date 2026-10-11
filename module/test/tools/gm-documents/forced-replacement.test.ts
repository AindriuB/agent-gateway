// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDLERS } from '../../../src/tools/index.js';
import { updatedDocument } from '../../../src/apps/approval/model.js';
import { setup } from './fixtures.js';

let f: ReturnType<typeof setup>;
beforeEach(() => {
  f = setup();
});
afterEach(() => f.restore());

/** Native-shaped legacy == behavior: v13 assigns the suffix field; v14 migrates
 * that key to ForcedReplacement and assigns it rather than recursively merging. */
function nativeReplacement(before: any, change: any): any {
  const out = structuredClone(before);
  for (const [path, value] of Object.entries(change)) {
    const segments = path.split('.');
    let target = out;
    while (segments.length > 1) {
      const segment = segments.shift()!;
      target = target[segment] ??= {};
    }
    const key = segments[0]!;
    const operator = (value as any)?.['__$OPERATOR$__'];
    if (operator === 'ForcedReplacement') target[key] = structuredClone((value as any).value);
    else if (operator === 'ForcedDeletion') delete target[key];
    else if (key.startsWith('==')) target[key.slice(2)] = structuredClone(value);
    else if (value && typeof value === 'object' && !Array.isArray(value))
      target[key] = nativeReplacement(target[key] ?? {}, value);
    else target[key] = structuredClone(value);
  }
  return out;
}

const changes = [
  { '==flags': {} },
  { 'flags.==agent-gateway': {} },
  { flags: { '==agent-gateway': {} } },
  { '==prototypeToken': {} },
  { prototypeToken: { '==flags': {} } },
  { 'prototypeToken.==flags': {} },
  { system: { custom: [{ '==flags': {} }] } },
  { system: { custom: [[{ flags: { '==agent-gateway': {} } }]] } },
  { 'system.custom.0.==flags': {} },
  { items: [{ name: 'Nested', system: { '==flags': {} } }] },
  { '-===flags': {} },
  { '-=-===flags': {} },
  { system: { '-===custom': {} } },
  { 'system.-===custom': {} },
  { '===flags': {} },
  { flags: { __$OPERATOR$__: 'ForcedReplacement', value: {} } },
  { flags: { __$OPERATOR$__: 'ForcedDeletion' } },
  { flags: { 'agent-gateway': { __$OPERATOR$__: 'ForcedReplacement', value: {} } } },
  { 'flags.__$OPERATOR$__': 'ForcedReplacement', 'flags.value': {} },
  { 'flags.-=__$OPERATOR$__': null },
  { prototypeToken: { flags: { __$OPERATOR$__: 'ForcedDeletion' } } },
  { system: { custom: [[{ __$OPERATOR$__: 'ForcedReplacement', value: {} }]] } },
  { 'system.custom.0.__$OPERATOR$__': 'ForcedDeletion' },
];

describe('forced replacement paths', () => {
  it.each([13, 14] as const)(
    'models the native v%i replacement that can erase flags while the preview retains them',
    (generation) => {
      f.restore();
      f = setup(generation);
      const before = {
        name: 'Before',
        flags: { 'agent-gateway': { retained: true }, custom: { value: 1 } },
      };
      const change = { '==flags': {} };
      expect(nativeReplacement(before, change).flags).toEqual({});
      expect(updatedDocument(before, change).flags).toEqual(before.flags);
      const nested = { 'flags.==agent-gateway': {} };
      expect(nativeReplacement(before, nested).flags['agent-gateway']).toEqual({});
      expect(updatedDocument(before, nested).flags['agent-gateway']).toEqual({ retained: true });
    },
  );
  it.each(['ForcedReplacement', 'ForcedDeletion'])(
    'models native v14 serialized %s escaping an ordinary preview',
    (operator) => {
      const before = { flags: { 'agent-gateway': { retained: true } } };
      const change = { flags: { __$OPERATOR$__: operator, value: {} } };
      const native = nativeReplacement(before, change);
      expect(native.flags?.['agent-gateway']).toBeUndefined();
      expect(updatedDocument(before, change).flags['agent-gateway']).toEqual({ retained: true });
    },
  );
  it.each(changes)('rejects %j before update preview, snapshot or mutation', async (change) => {
    const doc = f.doc('Actor', { flags: { 'agent-gateway': { retained: true } } });
    const source = doc.toObject();
    const readSource = vi.spyOn(doc, 'toObject');
    const args = { uuid: doc.uuid, update: JSON.stringify(change) };
    const ctx = f.ctx('document_update', args);
    expect(await HANDLERS.document_update!(ctx)).toMatchObject({
      error: { code: 'INVALID_ARGS' },
    });
    expect(readSource).not.toHaveBeenCalled();
    expect(ctx.snapshot).not.toHaveBeenCalled();
    expect(doc.update).not.toHaveBeenCalled();
    expect(doc.toObject()).toEqual(source);
    expect(f.mutations).toHaveLength(0);
  });
  it.each(changes)(
    'rejects create/import %j through the same guard before create intent/native writes',
    async (change) => {
      const args = { type: 'Actor', data: JSON.stringify({ name: 'Create', ...change }) };
      const ctx = f.ctx('document_create', args);
      expect(await HANDLERS.document_create!(ctx)).toHaveProperty('error');
      expect(ctx.intendCreate).not.toHaveBeenCalled();
      const { entry } = f.pack();
      const original = entry.toObject();
      entry.toObject = () => structuredClone({ ...original, ...change });
      const importArgs = { uuid: entry.uuid };
      const importCtx = f.ctx('compendium_import', importArgs);
      expect(await HANDLERS.compendium_import!(importCtx)).toHaveProperty('error');
      expect(importCtx.intendCreate).not.toHaveBeenCalled();
      expect(f.classes.Actor.create).not.toHaveBeenCalled();
      expect(f.mutations).toHaveLength(0);
    },
  );
  it('preserves supported deletion paths and ordinary custom data containing literal == text', async () => {
    const doc = f.doc('Actor', {
      system: { obsolete: true },
      flags: { 'agent-gateway': { retained: true } },
    });
    const change = {
      'system.-=obsolete': null,
      'system.custom': { text: '==ordinary text __$OPERATOR$__', 'contains==text': true },
    };
    const args = { uuid: doc.uuid, update: JSON.stringify(change) };
    expect(await HANDLERS.document_update!(f.ctx('document_update', args))).toHaveProperty(
      'structured.uuid',
    );
    expect(doc.flags['agent-gateway']).toEqual({ retained: true });
    expect(doc.system).toEqual({
      custom: { text: '==ordinary text __$OPERATOR$__', 'contains==text': true },
    });
  });
});
