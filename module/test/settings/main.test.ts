import { afterEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

let stub: FoundryStub;
afterEach(() => stub?.uninstall());

it.each([13, 14] as const)('main registers on init and logs ready (v%i)', async (gen) => {
  vi.resetModules();
  stub = installFoundry(gen);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../../src/main.js');
  stub.fire('init');
  expect(stub.registeredSettings.size).toBe(11);
  stub.fire('ready');
  expect(log).toHaveBeenCalledWith(`agent-gateway | ready (v${gen})`);
  log.mockRestore();
});
