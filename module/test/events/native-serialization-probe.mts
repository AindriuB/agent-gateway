import assert from 'node:assert/strict';
import vm from 'node:vm';
import { task27NativeState, task27ParticipantState } from './native-state.js';
for (const callback of [task27NativeState, task27ParticipantState]) {
  assert.doesNotMatch(callback.toString(), /__name/);
  const realm = vm.createContext({ game: { ready: false } });
  await assert.rejects(
    vm.runInContext(`(${callback.toString()})({generation:14})`, realm),
    /native (GM|participant)/,
  );
  assert.equal('__name' in realm, false);
}
console.log('Task27 actual tsx standalone callback serialization PASS');
