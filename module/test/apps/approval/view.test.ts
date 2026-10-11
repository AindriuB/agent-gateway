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
  stub.uninstall();
  vi.clearAllMocks();
});
describe('approval presentation', () => {
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
    App.approveAll.call(app, null, { dataset: { groupId: 'group' } });
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
