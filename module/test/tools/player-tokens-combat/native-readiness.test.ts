/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readNativeReadiness } from './native-readiness.js';
const g = globalThis as any;
let saved: any;
let users: any[];
let anchor: any;
let audit: any;
let actor: any;
beforeEach(() => {
  saved = { game: g.game, CONFIG: g.CONFIG };
  users = [
    { id: 'gm', name: 'dev-gm', isGM: true, active: true },
    { id: 'p1', name: 'Player1', isGM: false, active: false },
  ];
  anchor = {
    key: 'agent-gateway.auditJournalId',
    user: null,
    value: 'audit',
    _stats: { lastModifiedBy: 'gm' },
  };
  audit = {
    flags: { 'agent-gateway': { auditJournal: true } },
    ownership: { default: 0 },
    getUserLevel: () => 0,
  };
  actor = class {
    static create = vi.fn();
    validate() {
      return true;
    }
  };
  const collection = {
    get: (id: string) => users.find((u) => u.id === id),
    find: (fn: any) => users.find(fn),
    filter: (fn: any) => users.filter(fn),
    some: (fn: any) => users.some(fn),
    get activeGM() {
      return users.find((u) => u.active && u.isGM);
    },
  };
  g.game = {
    user: users[0],
    users: collection,
    world: { id: 'test-world' },
    system: { id: 'pf2e' },
    version: '14.369',
    modules: new Map([['agent-gateway', { version: '0.1.0', active: true }]]),
    documentTypes: { JournalEntryPage: ['agent-gateway.audit'] },
    journal: { get: () => audit },
    settings: { get: () => 'audit', storage: new Map([['world', { getSetting: () => anchor }]]) },
    time: { worldTime: 123 },
  };
  g.CONFIG = {
    time: { turnTime: 0, roundTime: 6 },
    Actor: { documentClass: actor },
    Scene: { documentClass: { create: vi.fn() } },
    Combat: { documentClass: { create: vi.fn() } },
  };
});
afterEach(() => {
  g.game = saved.game;
  g.CONFIG = saved.CONFIG;
});
describe('actual native read-only readiness helper', () => {
  it('reports missing installed registration without certifying actual proof readiness', () => {
    g.game.settings.get = () => {
      throw Error('unregistered');
    };
    expect(
      readNativeReadiness({ playerName: 'Player1', version: 'v14', reportOnly: true }),
    ).toMatchObject({ actualProofReady: false, registeredCacheMatches: false });
    expect(() => readNativeReadiness({ playerName: 'Player1', version: 'v14' })).toThrow(
      'registered',
    );
  });
  it.each(['v13', 'v14'])(
    'validates native decoded Setting provenance and zero-time fixture on %s',
    (version) => {
      g.game.version = version === 'v13' ? '13.351' : '14.369';
      expect(readNativeReadiness({ playerName: 'player1', version })).toMatchObject({
        turnTime: 0,
        roundTime: 6,
        worldTime: 123,
        player: { id: 'p1' },
      });
      expect(actor.create).not.toHaveBeenCalled();
      expect(g.CONFIG.Scene.documentClass.create).not.toHaveBeenCalled();
      expect(g.CONFIG.Combat.documentClass.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    'otherGM',
    'system',
    'auditType',
    'auditFlag',
    'writer',
    'acl',
    'turnTime',
    'roundTime',
    'actorInvalid',
    'encodedSetting',
    'wrongWorld',
    'generation',
    'duplicatePlayer',
    'gmPlayer',
    'inactiveModule',
    'cacheMismatch',
  ])('fails before native writes on %s', (kind) => {
    if (kind === 'duplicatePlayer') users.push({ id: 'p2', name: 'PLAYER1', isGM: false });
    if (kind === 'gmPlayer') users[1].isGM = true;
    if (kind === 'inactiveModule') g.game.modules.get('agent-gateway').active = false;
    if (kind === 'cacheMismatch') g.game.settings.get = () => 'other';
    if (kind === 'otherGM') users.push({ id: 'gm2', name: 'other', isGM: true, active: true });
    if (kind === 'system') g.game.system.id = 'other';
    if (kind === 'auditType') g.game.documentTypes.JournalEntryPage = [];
    if (kind === 'auditFlag') audit.flags = {};
    if (kind === 'writer') anchor._stats.lastModifiedBy = 'p1';
    if (kind === 'acl') audit.getUserLevel = () => 1;
    if (kind === 'turnTime') g.CONFIG.time.turnTime = 1;
    if (kind === 'roundTime') g.CONFIG.time.roundTime = Infinity;
    if (kind === 'actorInvalid') actor.prototype.validate = () => false;
    if (kind === 'encodedSetting') anchor.value = '"audit"';
    if (kind === 'wrongWorld') g.game.world.id = 'campaign';
    if (kind === 'generation') g.game.version = '13.351';
    expect(() => readNativeReadiness({ playerName: 'Player1', version: 'v14' })).toThrow();
    expect(actor.create).not.toHaveBeenCalled();
  });
});
