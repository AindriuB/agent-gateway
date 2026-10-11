import assert from 'node:assert/strict';
import vm from 'node:vm';
import { task24StepFacts } from './native-facts.js';
import { task24RemoveFixtures } from './native-lifecycle.js';
import { task24Readiness } from './native-readiness.js';
// Actual tsx loader -> isolated browser realm; no helper injected into the realm.
for (const callback of [task24StepFacts, task24Readiness, task24RemoveFixtures])
  assert.doesNotMatch(callback.toString(), /__name/);
const scene = { uuid: 'Scene.fixture' };
const realm = vm.createContext({
  game: { time: { worldTime: 10 }, scenes: { contents: [] } },
  canvas: { scene },
  fromUuid: async (uuid: string) => (uuid === scene.uuid ? scene : null),
});
const input = {
  index: 0,
  ids: {
    scene: scene.uuid,
    actor: 'Actor.a',
    combat: 'Combat.c',
    tokens: [],
    combatants: [],
    level: '',
  },
  baseline: { worldTime: 10, activeScenes: [] },
  generation: 13,
};
const result = await vm.runInContext(
  `(${task24StepFacts.toString()})(${JSON.stringify(input)})`,
  realm,
);
assert.equal(result.worldTimeUnchanged, true);
assert.equal('__name' in realm, false);
console.log('Task24 actual-tsx browser serialization PASS');
