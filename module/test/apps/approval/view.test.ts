// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  records: vi.fn(() => [] as any[]),
  pending: vi.fn(() => [] as any[]),
}));
vi.mock('../../../src/approvals/live.js', () => ({
  getApprovalManager: () => ({ ownRecords: mocks.records, listPending: mocks.pending }),
}));
vi.mock('../../../src/ops/registry.js', () => ({ toolRegistry: { info: mocks.info } }));
import {
  requestView,
  installApprovalUi,
  createApprovalApp,
} from '../../../src/apps/approval/index.js';
import { ApprovalUiController } from '../../../src/apps/approval/controller.js';
import { installFoundry, type FoundryStub } from '../../stubs/foundry.js';
const request = (overrides = {}) => ({
  id: 'request',
  agentId: 'agent-id',
  sessionId: 's',
  tool: 'document_update',
  args: {},
  argsHash: 'hash',
  category: 'write',
  approver: 'owner' as const,
  createdAt: 0,
  expiresAt: 10000,
  requesterId: 'owner',
  local: true,
  ...overrides,
});
let stub: FoundryStub;
beforeEach(() => {
  stub = installFoundry(14);
  mocks.info.mockReturnValue({ origin: 'core' });
  mocks.records.mockReturnValue([]);
  mocks.pending.mockReturnValue([]);
});
afterEach(() => {
  document.body.replaceChildren();
  stub.uninstall();
  vi.clearAllMocks();
});
describe('approval presentation', () => {
  it('hides session approval for replay while preserving ordinary writes', async () => {
    expect(await requestView(request({ replay: true }))).toMatchObject({ sessionAllowed: false });
    expect(await requestView(request())).toMatchObject({ sessionAllowed: true });
  });
  it('loads the visible current document to diff partial update arguments', async () => {
    const load = vi.fn(async () => ({
      testUserPermission: () => true,
      toObject: () => ({ name: 'Old', system: { value: 1, max: 9 } }),
    }));
    (globalThis as any).fromUuid = load;
    const view = await requestView(
      request({ args: { uuid: 'Actor.fixture', update: JSON.stringify({ 'system.value': 2 }) } }),
    );
    expect(load).toHaveBeenCalledWith('Actor.fixture', undefined);
    expect(view).toMatchObject({
      diff: [{ path: 'system.value', old: '1', new: '2' }],
      unavailable: false,
    });
  });
  it('falls back safely for invalid or deeply nested update JSON strings', async () => {
    (globalThis as any).fromUuid = async () => ({
      testUserPermission: () => true,
      toObject: () => ({}),
    });
    let deep = '{}';
    for (let i = 0; i < 10000; i++) deep = '{"child":' + deep + '}';
    for (const update of ['{invalid', deep, '[]']) {
      expect(await requestView(request({ args: { uuid: 'Actor.fixture', update } }))).toMatchObject(
        { diff: [], unavailable: true },
      );
    }
  });
  it('does not expose raw document fields to an approver who only has observer access', async () => {
    const source = vi.fn();
    const permission = vi.fn((_user: unknown, level: string) => level === 'OBSERVER');
    (globalThis as any).fromUuid = async () => ({
      testUserPermission: permission,
      toObject: source,
    });
    expect(
      await requestView(
        request({
          args: { uuid: 'Actor.visible', update: JSON.stringify({ 'system.privateNotes': 'new' }) },
        }),
      ),
    ).toMatchObject({ diff: [], unavailable: true });
    expect(permission).toHaveBeenCalledWith((globalThis as any).game.user, 'OWNER');
    expect(source).not.toHaveBeenCalled();
  });
  it('keeps all 500 lines of code, without granting a session action for code', async () => {
    const source = Array.from({ length: 500 }, (_, i) => `// line ${i + 1}`).join('\n');
    expect(await requestView(request({ category: 'code', args: { source } }))).toMatchObject({
      code: source,
      isCode: true,
      sessionAllowed: false,
    });
  });
  it('uses registry pack provenance and always retains the full generic payload', async () => {
    mocks.info.mockReturnValue({
      origin: { packId: '<pack>', version: '1.2.3', prefix: 'fixture' },
    });
    expect(
      await requestView(
        request({ tool: 'fixture-write', args: { html: '<img src=x onerror=alert(1)>' } }),
      ),
    ).toMatchObject({
      tool: 'fixture-write',
      pack: { id: '<pack>', version: '1.2.3' },
      args: '{\n  "html": "<img src=x onerror=alert(1)>"\n}',
    });
  });
  it('paginates five complete payloads and only approves the rows actually shown', async () => {
    const requests = Array.from({ length: 7 }, (_, i) => request({ id: `r${i}` }));
    const resolveApproval = vi.fn(() => true);
    const controller = new ApprovalUiController({
      manager: () => ({ listPending: () => requests, ownRecords: () => [], resolveApproval }),
      isGM: () => true,
      now: () => 0,
      on: () => {},
      present: () => {},
    });
    const App = createApprovalApp(controller);
    const app = new App();
    app.groups = [{ id: 'group', requests }];
    const first = await app._prepareContext();
    expect(first.groups[0].requests).toHaveLength(5);
    expect(first.next).toBe(true);
    const button = commitView(app, first);
    App.approveAll.call(app, null, button);
    expect(resolveApproval.mock.calls.map((c) => c[0])).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
    app.page = 1;
    const second = await app._prepareContext();
    expect(second.groups[0].requests.map((r: any) => r.id)).toEqual(['r5', 'r6']);
    expect(second.previous).toBe(true);
    expect(second.next).toBe(false);
  });
  it('installs the public bootstrap repeatedly without duplicating hook listeners', () => {
    const on = vi.fn();
    (globalThis as any).Hooks.on = on;
    installApprovalUi();
    installApprovalUi();
    expect(on.mock.calls.map((c) => c[0])).toEqual([
      'agentGateway.approvalRequested',
      'agentGateway.approvalResolved',
      'updateUser',
    ]);
    expect(mocks.pending).toHaveBeenCalledTimes(2);
  });
});

// Commit real controls separately from context preparation, as the native render lifecycle does.
function commitView(app: any, context: any): HTMLButtonElement {
  const root = document.createElement('div');
  for (const group of context.groups) {
    const section = document.createElement('section');
    section.className = 'ag-approval-group';
    const button = document.createElement('button');
    button.dataset.action = 'approveAll';
    button.dataset.groupId = group.id;
    section.append(button);
    for (const request of group.requests) {
      const article = document.createElement('article');
      article.dataset.request = request.id;
      if (request.reviewable) {
        const approve = document.createElement('button');
        approve.dataset.action = 'approve';
        approve.dataset.requestId = request.id;
        article.append(approve);
      }
      section.append(article);
    }
    root.append(section);
  }
  app.element?.remove();
  app.element = root;
  document.body.append(root);
  return root.querySelector('button')!;
}

function raceApp(requests: any[]) {
  const resolveApproval = vi.fn(() => true);
  const controller = new ApprovalUiController({
    manager: () => ({ listPending: () => requests, ownRecords: () => [], resolveApproval }),
    isGM: () => true,
    now: () => 0,
    on: () => {},
    present: () => {},
  });
  const App = createApprovalApp(controller);
  const app = new App();
  app.groups = [{ id: 'group', requests: [...requests] }];
  return { App, app, resolveApproval };
}

it('approves only committed rows while a new document preview is awaiting resolution', async () => {
  const requests = [request({ id: 'visible' })];
  const { App, app, resolveApproval } = raceApp(requests);
  const button = commitView(app, await app._prepareContext());
  let release!: (value: any) => void;
  (globalThis as any).fromUuid = vi.fn(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  requests.push(request({ id: 'unseen', args: { uuid: 'Actor.delayed', update: '{}' } }));
  app.groups = [{ id: 'group', requests: [...requests] }];
  const preparing = app._prepareContext();
  App.approveAll.call(app, null, button);
  expect(resolveApproval.mock.calls.map((c) => c[0])).toEqual(['visible']);
  release(null);
  await preparing; // Discarded/failed DOM render must not change the old action.
  resolveApproval.mockClear();
  App.approveAll.call(app, null, button);
  expect(resolveApproval.mock.calls.map((c) => c[0])).toEqual(['visible']);
});

it('uses committed DOM even when preview preparations complete out of order', async () => {
  const requests = [
    request({ id: 'slow', args: { uuid: 'Actor.slow', update: '{}' } }),
    request({ id: 'fast' }),
  ];
  const { App, app, resolveApproval } = raceApp(requests);
  let release!: (value: any) => void;
  (globalThis as any).fromUuid = () =>
    new Promise((done) => {
      release = done;
    });
  app.groups = [{ id: 'group', requests: [requests[0]] }];
  const slow = app._prepareContext();
  app.groups = [{ id: 'group', requests: [requests[1]] }];
  const fastButton = commitView(app, await app._prepareContext());
  release(null);
  const slowContext = await slow;
  App.approveAll.call(app, null, fastButton);
  expect(resolveApproval.mock.calls.map((c) => c[0])).toEqual(['fast']);
  resolveApproval.mockClear();
  const slowButton = commitView(app, slowContext);
  App.approveAll.call(app, null, fastButton); // Detached button from the superseded render.
  expect(resolveApproval).not.toHaveBeenCalled();
  App.approveAll.call(app, null, slowButton);
  expect(resolveApproval.mock.calls.map((c) => c[0])).toEqual(['slow']);
});

it('fails closed for uncommitted, oversized or duplicate group rows and rechecks eligibility', async () => {
  const requests = [request({ id: 'visible' })];
  const { App, app, resolveApproval } = raceApp(requests);
  const context = await app._prepareContext();
  App.approveAll.call(app, null, document.createElement('button'));
  expect(resolveApproval).not.toHaveBeenCalled();
  const button = commitView(app, context);
  const row = app.element.querySelector('article');
  row.append(document.createElement('span'));
  row.after(row.cloneNode(true));
  App.approveAll.call(app, null, button);
  expect(resolveApproval).not.toHaveBeenCalled();
  const oversized = commitView(app, context);
  const group = oversized.closest('section')!;
  for (let i = 0; i < 5; i++) {
    const extra = row.cloneNode(true) as HTMLElement;
    extra.dataset.request = `extra-${i}`;
    group.append(extra);
  }
  App.approveAll.call(app, null, oversized);
  expect(resolveApproval).not.toHaveBeenCalled();
  const unreviewable = commitView(app, {
    groups: [{ id: 'group', requests: [{ id: 'visible', reviewable: false }] }],
  });
  App.approveAll.call(app, null, unreviewable);
  expect(resolveApproval).not.toHaveBeenCalled();
  const valid = commitView(app, context);
  requests.length = 0;
  App.approveAll.call(app, null, valid);
  expect(resolveApproval).not.toHaveBeenCalled();
});
