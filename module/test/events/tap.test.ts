/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, expect, it, vi } from 'vitest';
import { EVENT_CONFIG } from '@agent-gateway/protocol';
import { installEventTap } from '../../src/events/index.js';
afterEach(() => vi.useRealTimers());
function setup(connected = true) {
  vi.useFakeTimers();
  const callbacks = new Map<string, Map<unknown, (...args: any[]) => void>>();
  let next = 0;
  const hooks = {
    on: (name: string, fn: (...args: any[]) => void) => {
      const id = next++;
      if (!callbacks.has(name)) callbacks.set(name, new Map());
      callbacks.get(name)!.set(id, fn);
      return id;
    },
    off: (name: string, id: unknown) => {
      callbacks.get(name)?.delete(id);
    },
  };
  let user: any = { id: 'observer', isGM: false, viewedScene: 's' };
  const scene: any = {
    id: 's',
    uuid: 'Scene.s',
    documentName: 'Scene',
    name: 'Secret scene name',
    navName: 'Public scene',
    testUserPermission: () => true,
  };
  const canvas: any = { ready: true, scene };
  const frames: any[] = [];
  let notify: (s: { kind: string }) => void = () => {};
  const client = {
    state: { kind: connected ? 'connected' : 'connecting' },
    onState: (fn: typeof notify) => {
      notify = fn;
      return () => {
        notify = () => {};
      };
    },
    sendMessage: (frame: any) => frames.push(frame),
  };
  const deps = {
    hooks,
    user: () => user,
    canvas: () => canvas,
    now: () => 1000,
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  const handle = installEventTap(client, deps);
  return {
    client,
    deps,
    handle,
    frames,
    scene,
    canvas,
    callbacks,
    user: () => user,
    setUser: (u: any) => {
      user = u;
    },
    state: (kind: string) => {
      client.state = { kind };
      notify(client.state);
    },
    hook: (name: string, ...args: any[]) => {
      for (const fn of callbacks.get(name)?.values() ?? []) fn(...args);
    },
  };
}
function doc(type = 'Actor', id = 'a'): any {
  return {
    id,
    uuid: `${type}.${id}`,
    documentName: type,
    name: 'Visible name',
    testUserPermission: () => true,
  };
}
it('installs once, sends only welcomed events and resets sequence only on a new connection', () => {
  const s = setup(false);
  expect(installEventTap(s.client, s.deps)).toBe(s.handle);
  s.hook('createActor', doc());
  expect(s.frames).toHaveLength(0);
  s.state('connected');
  s.hook('createActor', doc());
  s.state('connected');
  s.hook('createItem', doc('Item'));
  expect(s.frames.map((f) => f.event.seq)).toEqual([1, 2]);
  s.state('disconnected');
  s.hook('createActor', doc());
  s.state('connected');
  s.hook('createActor', doc());
  expect(s.frames.map((f) => f.event.seq)).toEqual([1, 2, 1]);
  s.handle.dispose();
  s.hook('createActor', doc());
  expect(s.frames).toHaveLength(3);
  expect([...s.callbacks.values()].every((m) => m.size === 0)).toBe(true);
});
it('coalesces only updates with last visible name and retained agent provenance', () => {
  const s = setup(),
    a = doc();
  s.hook('createActor', a);
  s.hook('updateActor', a, { secret: 'not sent' }, { agentGateway: { callId: 'call' } });
  a.name = 'Latest name';
  s.hook('updateActor', a, { system: { secret: true } }, {});
  vi.advanceTimersByTime(499);
  expect(s.frames).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(s.frames[1].event).toMatchObject({
    seq: 2,
    type: 'actor_update',
    agent_action: true,
    doc: { name: 'Latest name' },
    userId: 'observer',
  });
  expect(JSON.stringify(s.frames)).not.toContain('secret');
});
it('delete cancels a pending update and preserves create/delete order', () => {
  const s = setup(),
    a = doc();
  s.hook('createActor', a);
  s.hook('updateActor', a, {}, {});
  s.hook('deleteActor', a, {});
  vi.advanceTimersByTime(500);
  expect(s.frames.map((f) => f.event.type)).toEqual(['actor_create', 'actor_delete']);
});
it('rechecks visibility, ancestry and protected audit state at delayed flush', () => {
  const s = setup(),
    a = doc();
  let visible = true;
  a.testUserPermission = () => visible;
  s.hook('updateActor', a, {}, {});
  visible = false;
  vi.advanceTimersByTime(500);
  expect(s.frames).toHaveLength(0);
  visible = true;
  s.hook('updateActor', a, {}, {});
  a.parent = { testUserPermission: () => false };
  vi.advanceTimersByTime(500);
  expect(s.frames).toHaveLength(0);
  delete a.parent;
  a.flags = { 'agent-gateway': { auditJournal: true } };
  s.hook('createActor', a);
  expect(s.frames).toHaveLength(0);
});
it('drops queued updates across disconnects and refuses a changed observing principal', () => {
  const s = setup(),
    a = doc();
  s.hook('updateActor', a, {}, {});
  s.state('disconnected');
  s.state('connected');
  vi.advanceTimersByTime(500);
  expect(s.frames).toHaveLength(0);
  s.hook('createActor', a);
  s.hook('updateActor', a, {}, {});
  s.setUser({ id: 'other', isGM: true });
  vi.advanceTimersByTime(500);
  s.hook('createActor', a);
  expect(s.frames).toHaveLength(1);
});
it('bounds pending unique updates without retaining full payloads or inventing gaps', () => {
  const s = setup();
  for (let i = 0; i < EVENT_CONFIG.MAX_PENDING_UPDATES + 20; i++)
    s.hook('updateActor', doc('Actor', String(i)), { huge: 'x'.repeat(10000) }, {});
  vi.advanceTimersByTime(500);
  expect(s.frames).toHaveLength(EVENT_CONFIG.MAX_PENDING_UPDATES);
  expect(s.frames.every((f) => f.event.type === 'actor_update')).toBe(true);
  expect(s.frames[0].event).not.toHaveProperty('data');
});
it('uses native chat content visibility even for visible private roll placeholders and GM', () => {
  const s = setup();
  for (const isGM of [false, true]) {
    s.user().isGM = isGM;
    s.hook(
      'createChatMessage',
      {
        ...doc('ChatMessage'),
        visible: true,
        isContentVisible: false,
        isRoll: true,
        content: 'PRIVATE result',
      },
      {},
    );
  }
  expect(s.frames).toHaveLength(0);
  s.hook(
    'createChatMessage',
    {
      ...doc('ChatMessage'),
      isContentVisible: true,
      isRoll: true,
      name: 'PRIVATE result',
      rolls: [{ formula: 'secret' }],
    },
    {},
  );
  expect(s.frames[0].event).toMatchObject({
    type: 'roll',
    doc: { name: 'Chat message' },
    summary: 'A roll was posted',
  });
  expect(JSON.stringify(s.frames)).not.toMatch(/PRIVATE|secret/);
});
it('uses the existing rendered Token perception, never lazy object construction or hidden ownership', () => {
  const s = setup(),
    token = doc('Token');
  token.parent = s.scene;
  token.hidden = false;
  token._object = { document: token, destroyed: false, isVisible: false };
  Object.defineProperty(token, 'object', {
    get() {
      throw Error('Must not lazily construct');
    },
  });
  s.hook('createToken', token, {});
  expect(s.frames).toHaveLength(0);
  token._object.isVisible = true;
  token.hidden = true;
  s.hook('createToken', token, {});
  expect(s.frames).toHaveLength(0);
  token.hidden = false;
  token.parent = doc('Scene');
  s.hook('createToken', token, {});
  expect(s.frames).toHaveLength(0);
  token.parent = s.scene;
  delete token._object;
  s.hook('createToken', token, {});
  expect(s.frames).toHaveLength(0);
  token._object = { document: token, destroyed: false, isVisible: true };
  s.hook('createToken', token, {});
  expect(s.frames[0].event.type).toBe('token_create');
});
it('emits constant combat/approval summaries without counters, hidden actors, code or reasons', () => {
  const s = setup(),
    combat = { ...doc('Combat'), visible: true, name: 'SECRET', testUserPermission: () => false };
  s.hook(
    'combatTurn',
    combat,
    { round: 999, actor: 'SECRET' },
    { agentGateway: { callId: 'call' } },
  );
  s.hook('agentGateway.approvalRequested', { source: 'SECRET CODE', args: { secret: true } });
  s.hook('agentGateway.approvalResolved', { reason: 'SECRET REASON' });
  expect(s.frames.map((f) => f.event.type)).toEqual([
    'combat_turn',
    'approval_requested',
    'approval_resolved',
  ]);
  expect(s.frames[0].event.agent_action).toBe(true);
  expect(s.frames[0].event.doc.name).toBe('Combat');
  combat.visible = false;
  s.hook('combatRound', combat, {}, {});
  expect(s.frames).toHaveLength(3);
  expect(JSON.stringify(s.frames)).not.toMatch(/SECRET|999|args|reason/);
});
it('uses the visible navigation name and fails closed on throwing visibility', () => {
  const s = setup();
  s.hook('canvasReady', s.canvas);
  expect(s.frames[0].event.doc.name).toBe('Public scene');
  const a = doc();
  a.testUserPermission = () => {
    throw Error('no access');
  };
  s.hook('createActor', a);
  expect(s.frames).toHaveLength(1);
});

it('drops v13 destroyed Token deletes and emits only the still-rendered v14-visible path', () => {
  const s = setup(),
    token = { ...doc('Token'), parent: s.scene, hidden: false } as any;
  token._object = { document: token, destroyed: false, isVisible: true };
  s.hook('updateToken', token, {}, {});
  // v13 native _onDelete clears the cached object before deleteToken fires.
  token._object = null;
  s.hook('deleteToken', token, {});
  vi.advanceTimersByTime(500);
  expect(s.frames).toEqual([]);
  // v14 still has the placeable until the later _onDeleteOperation.
  token._object = { document: token, destroyed: false, isVisible: true };
  s.hook('deleteToken', token, { agentGateway: { callId: 'delete' } });
  expect(s.frames[0].event).toMatchObject({ type: 'token_delete', agent_action: true });
  token._object.destroyed = true;
  s.hook('deleteToken', token, {});
  expect(s.frames).toHaveLength(1);
});

it.each(['createScene', 'updateScene', 'deleteScene'])(
  'suppresses hidden %s despite OBSERVER permission',
  (hook) => {
    const s = setup();
    s.user().viewedScene = 'another-scene';
    s.scene.active = false;
    s.scene.navigation = false;
    // Client-local isView does not establish this requesting user's visibility.
    s.scene.isView = true;
    s.hook(hook, s.scene, {}, {});
    vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
    expect(s.frames).toEqual([]);
  },
);
it.each(['active', 'navigation', 'viewed', 'GM'])(
  'allows Scene lifecycle events visible through %s',
  (access) => {
    const s = setup();
    s.user().viewedScene = access === 'viewed' ? s.scene.id : 'another-scene';
    s.user().isGM = access === 'GM';
    s.scene.active = access === 'active';
    s.scene.navigation = access === 'navigation';
    s.hook('createScene', s.scene, {});
    s.hook('updateScene', s.scene, {}, {});
    vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
    s.hook('deleteScene', s.scene, {});
    expect(s.frames.map((f) => f.event.type)).toEqual([
      'scene_create',
      'scene_update',
      'scene_delete',
    ]);
    expect(s.frames.every((f) => f.event.doc.uuid === s.scene.uuid)).toBe(true);
    expect(s.frames[0].event.doc.name).toBe(access === 'GM' ? s.scene.name : s.scene.navName);
  },
);
it.each(['active', 'navigation', 'viewed'])(
  'rechecks Scene %s visibility at delayed flush',
  (access) => {
    const s = setup();
    s.user().viewedScene = access === 'viewed' ? s.scene.id : 'another-scene';
    s.scene.active = access === 'active';
    s.scene.navigation = access === 'navigation';
    s.hook('updateScene', s.scene, {}, {});
    s.scene.active = false;
    s.scene.navigation = false;
    s.user().viewedScene = 'another-scene';
    vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
    expect(s.frames).toEqual([]);
  },
);

function syntheticDocuments(s: ReturnType<typeof setup>) {
  const token = {
    ...doc('Token', 'private-token'),
    uuid: `${s.scene.uuid}.Token.private-token`,
    parent: s.scene,
    hidden: false,
    actorLink: false,
  } as any;
  token._object = { document: token, destroyed: false, isVisible: true };
  Object.defineProperty(token, 'object', {
    get() {
      throw Error('No lazy Token construction');
    },
  });
  const actor = {
    ...doc('Actor', 'synthetic'),
    uuid: `${token.uuid}.Actor.synthetic`,
    parent: token,
  };
  const item = {
    ...doc('Item', 'private-item'),
    uuid: `${actor.uuid}.Item.private-item`,
    parent: actor,
  };
  return { token, actor, item };
}
function concealToken(s: ReturnType<typeof setup>, token: any, state: string) {
  if (state === 'hidden') token.hidden = true;
  if (state === 'unrendered') delete token._object;
  if (state === 'imperceptible') token._object.isVisible = false;
  if (state === 'destroyed') token._object.destroyed = true;
  if (state === 'offscene') s.canvas.scene = doc('Scene', 'other');
}
it.each(['hidden', 'unrendered', 'imperceptible', 'destroyed', 'offscene'])(
  'suppresses synthetic Actor and Item lifecycle through a %s Token ancestor',
  (state) => {
    const s = setup(),
      { token, actor, item } = syntheticDocuments(s);
    concealToken(s, token, state);
    for (const target of [actor, item]) {
      s.hook(`create${target.documentName}`, target, {});
      s.hook(`update${target.documentName}`, target, {}, {});
      vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
      s.hook(`delete${target.documentName}`, target, {});
    }
    expect(s.frames).toEqual([]);
  },
);
it.each(['hidden', 'unrendered', 'imperceptible', 'destroyed', 'offscene'])(
  'rechecks %s Token ancestor perception before flushing synthetic updates',
  (state) => {
    const s = setup(),
      { token, actor, item } = syntheticDocuments(s);
    for (const target of [actor, item]) s.hook(`update${target.documentName}`, target, {}, {});
    concealToken(s, token, state);
    vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
    expect(s.frames).toEqual([]);
  },
);
it.each([false, true])('allows visible synthetic ancestry with native GM=%s perception', (isGM) => {
  const s = setup(),
    { token, actor, item } = syntheticDocuments(s);
  s.user().isGM = isGM;
  token.hidden = isGM;
  for (const target of [actor, item]) {
    s.hook(`create${target.documentName}`, target, {});
    s.hook(`update${target.documentName}`, target, {}, {});
    vi.advanceTimersByTime(EVENT_CONFIG.COALESCE_MS);
    s.hook(`delete${target.documentName}`, target, {});
  }
  expect(s.frames.map((f) => f.event.type)).toEqual([
    'actor_create',
    'actor_update',
    'actor_delete',
    'item_create',
    'item_update',
    'item_delete',
  ]);
  expect(s.frames[0].event.doc.uuid).toBe(actor.uuid);
  expect(s.frames[3].event.doc.uuid).toBe(item.uuid);
  token._object.isVisible = false;
  s.hook('createActor', actor, {});
  expect(s.frames).toHaveLength(6);
});
