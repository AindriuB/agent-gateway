import assert from 'node:assert/strict';
import vm from 'node:vm';
import { task25NativeState } from './native-state.js';
assert.doesNotMatch(task25NativeState.toString(), /__name/);
const gm = { id: 'gm', isGM: true, active: true },
  users = {
    get: (id: string) => (id === 'gm' ? gm : undefined),
    activeGM: gm,
    filter: (predicate: (u: typeof gm) => boolean) => [gm].filter(predicate),
  };
const realm = vm.createContext({
  game: { ready: true, world: { id: 'test-world' }, release: { generation: 14 }, user: gm, users },
});
await assert.rejects(
  vm.runInContext(`(${task25NativeState.toString()})({op:'invalid',generation:14})`, realm),
  /Unknown native harness operation/,
);
gm.isGM = false;
await assert.rejects(
  vm.runInContext(`(${task25NativeState.toString()})({op:'cleanup',generation:14})`, realm),
  /canonical GM prerequisite/,
);
assert.equal('__name' in realm, false);
console.log('Task25 actual tsx standalone browser serialization PASS');
