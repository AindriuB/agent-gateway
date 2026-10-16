/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installUploadProvisioning, provisioningIdle } from '../../../src/tools/_upload-dirs.js';

let hooks: Record<string, (...a: any[]) => void>;
let present: Set<string>;
let fp: any;
let users: any[];
let gm: any;
let activeGm: any;

const setup = (): void => {
  const g = globalThis as any;
  g.game = {
    user: gm,
    users: { contents: users, activeGM: activeGm },
    release: { generation: 14 },
  };
  g.Hooks = { on: vi.fn((name: string, fn: any) => (hooks[name] = fn)) };
  g.foundry = { applications: { apps: { FilePicker: { implementation: fp } } } };
};

beforeEach(() => {
  hooks = {};
  present = new Set();
  fp = {
    browse: vi.fn(async (_s: string, dir: string) => {
      if (!present.has(dir)) throw new Error('missing');
      return { files: [] };
    }),
    createDirectory: vi.fn(async (_s: string, dir: string) => {
      present.add(dir);
    }),
  };
  gm = { id: 'gm', isGM: true, can: () => true };
  activeGm = gm;
  users = [
    gm,
    { id: 'p1', isGM: false, can: (p: string) => p === 'FILES_UPLOAD' },
    { id: 'p2', isGM: false, can: () => false },
    { id: 'bad/id', isGM: false, can: () => true },
  ];
  setup();
});
afterEach(() => {
  const g = globalThis as any;
  delete g.game;
  delete g.Hooks;
  delete g.foundry;
  vi.restoreAllMocks();
});

const created = (): string[] => fp.createDirectory.mock.calls.map((c: any[]) => c[1]);

describe('GM upload provisioning', () => {
  it('creates folders only for users with FILES_UPLOAD and a valid id, using fixed levels', async () => {
    installUploadProvisioning();
    await provisioningIdle();
    const allowed = new Set(
      ['gm', 'p1'].flatMap((id) => [
        'agent-gateway',
        'agent-gateway/uploads',
        `agent-gateway/uploads/${id}`,
      ]),
    );
    expect(created().length).toBeGreaterThan(0);
    for (const dir of created()) expect(allowed.has(dir)).toBe(true);
    expect(created()).toContain('agent-gateway/uploads/p1');
    expect(created().some((d) => d.includes('p2') || d.includes('bad'))).toBe(false);
  });
  it('is idempotent: a second run with every level present creates nothing', async () => {
    installUploadProvisioning();
    await provisioningIdle();
    fp.createDirectory.mockClear();
    hooks.updateUser!();
    await provisioningIdle();
    expect(fp.createDirectory).not.toHaveBeenCalled();
  });
  it('does nothing for a GM who is not the active GM', async () => {
    activeGm = { id: 'other', isGM: true };
    setup();
    installUploadProvisioning();
    await provisioningIdle();
    expect(fp.browse).not.toHaveBeenCalled();
    expect(fp.createDirectory).not.toHaveBeenCalled();
  });
  it('does nothing for a non-GM client', async () => {
    gm = users[1];
    activeGm = users[0];
    setup();
    installUploadProvisioning();
    await provisioningIdle();
    expect(fp.createDirectory).not.toHaveBeenCalled();
  });
  it('logs a createDirectory rejection and does not reject', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fp.createDirectory = vi.fn(async () => {
      throw new Error('boom');
    });
    installUploadProvisioning();
    await expect(provisioningIdle()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]![0])).toMatch(/^agent-gateway \| /);
  });
  it('re-runs on updateUser, createUser and core.permissions settings only', async () => {
    installUploadProvisioning();
    await provisioningIdle();
    const runs = (): number => fp.browse.mock.calls.length;
    const bump = async (fn: () => void): Promise<boolean> => {
      const before = runs();
      fn();
      await provisioningIdle();
      return runs() > before;
    };
    expect(await bump(() => hooks.updateUser!())).toBe(true);
    expect(await bump(() => hooks.createUser!())).toBe(true);
    expect(await bump(() => hooks.updateSetting!({ key: 'core.permissions' }))).toBe(true);
    expect(await bump(() => hooks.createSetting!({ key: 'core.permissions' }))).toBe(true);
    expect(await bump(() => hooks.updateSetting!({ key: 'core.other' }))).toBe(false);
  });
});

describe('upload dir review fixes', () => {
  it('names the caller folder when every level is missing', async () => {
    const { ensureUploadDirs } = await import('../../../src/tools/_upload-dirs.js');
    await expect(ensureUploadDirs(fp, { id: 'p1', isGM: false, role: 1 }, 'p1')).rejects.toThrow(
      /agent-gateway\/uploads\/p1 does not exist/,
    );
  });

  it('merges triggers arriving during a run into one follow-up run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const origBrowse = fp.browse;
    fp.browse = vi.fn(async (...a: any[]) => {
      await gate;
      return origBrowse(...a);
    });
    installUploadProvisioning();
    for (let i = 0; i < 5; i++) hooks['updateUser']!();
    await Promise.resolve();
    release();
    await provisioningIdle();
    // two runs of users gm+p1 (3 levels each) at most
    const firstLevelBrowses = fp.browse.mock.calls.filter((c: any[]) => c[1] === 'agent-gateway');
    expect(firstLevelBrowses.length).toBe(4);
  });
});
