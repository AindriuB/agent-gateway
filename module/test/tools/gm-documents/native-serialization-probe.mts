import assert from 'node:assert/strict';
import vm from 'node:vm';
import { observeNativeAuditProgress } from './native-audit-progress.js';
import { nativeObserverScript } from './native-observer-script.js';
const target = {
  journalUuid: 'JournalEntry.audit',
  pageId: 'exact',
  gmId: 'gm',
  roots: ['Actor.a', 'Item.b', 'JournalEntry.c'],
};
const system = { undoCompleted: target.roots, undoneBy: 'gm', undoneAt: 123 };
const response = {
  type: 'JournalEntryPage',
  operation: { parentUuid: target.journalUuid },
  result: [{ _id: target.pageId, system }],
};
const update = {
  type: 'JournalEntryPage',
  action: 'update',
  operation: { parentUuid: target.journalUuid, updates: [{ _id: target.pageId }] },
};
const socket = {
  dispatch: (...args: unknown[]) =>
    Promise.resolve(
      JSON.stringify(args).includes('undoReservation') ? { ...response, result: [] } : response,
    ),
};
const realm = vm.createContext({ SocketInterface: socket, setTimeout, clearTimeout });
assert.match(observeNativeAuditProgress.toString(), /__name/);
assert.throws(
  () =>
    vm.runInContext(`(${observeNativeAuditProgress.toString()})(${JSON.stringify(target)})`, realm),
  /__name is not defined/,
);
const observer = vm.runInContext(nativeObserverScript(target), realm);
await socket.dispatch('modifyDocument', update);
await observer.drain();
await observer.read();
assert.equal(observer.complete(), true);
assert.equal('__name' in realm, false);
observer.stop();
console.log('actual-tsx isolated-browser serialization PASS');
