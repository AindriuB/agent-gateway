import { AdapterUnsupportedError, type ConditionChange, type SystemAdapter } from '../types.js';
export const genericAdapter: SystemAdapter = Object.freeze({
  systemId: 'generic',
  actorSummary(actor: unknown) {
    const doc = actor as { name: string; img: string; type: string };
    return { name: doc.name, img: doc.img, type: doc.type, attributes: [] };
  },
  listActions: () => ({ supported: false, actions: [] }),
  performAction() {
    throw new AdapterUnsupportedError();
  },
  inventorySemantics: () => ({ supported: false, items: [], totals: [] }),
  conditions(_actor: unknown, change?: ConditionChange) {
    if (change !== undefined) throw new AdapterUnsupportedError();
    return { supported: false, conditions: [] };
  },
});
