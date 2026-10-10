import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../../src/tools/index.js');
  vi.resetModules();
});

describe('registry module loading', () => {
  it('installs audit lifecycle hooks while main is loading', async () => {
    vi.resetModules();
    const once = vi.fn();
    vi.stubGlobal('Hooks', { once, on: vi.fn() });
    try {
      await import('../../../src/main.js');
      expect(once.mock.calls.some(([hook, fn]) => hook === 'init' && fn.name === 'initAudit')).toBe(
        true,
      );
      expect(
        once.mock.calls.some(([hook, fn]) => hook === 'ready' && fn.name === 'readyAudit'),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('metadata readers fail closed before dispatcher bootstrap', async () => {
    vi.resetModules();
    const { liveToolMetadata } = await import('../../../src/ops/registry-class.js');
    expect(liveToolMetadata.info('world_info')).toBeUndefined();
    expect(liveToolMetadata.categoryOf('world_info')).toBeUndefined();
    expect(liveToolMetadata.list()).toEqual([]);
    expect(liveToolMetadata.forRole(true)).toEqual([]);
  });
  it.each([
    '../../../src/ops/registry.js',
    '../../../src/ops/dispatch.js',
    '../../../src/approvals/manager.js',
    '../../../src/tools/index.js',
    '../../../src/ops/core-tools.js',
    '../../../src/policy/stage.js',
    '../../../src/ratelimit/stage.js',
    '../../../src/approvals/stage.js',
    '../../../src/audit/stage.js',
  ])('loads safely starting from %s', async (entrypoint) => {
    vi.resetModules();
    await expect(import(entrypoint)).resolves.toBeDefined();
    const { toolRegistry } = await import('../../../src/ops/registry.js');
    expect(toolRegistry.info('world_info')).toBeDefined();
  });
});
