import { expect, it, vi } from 'vitest';

vi.mock('../../../src/tools/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/tools/index.js')>();
  const handlers = { ...original.HANDLERS };
  delete handlers.world_info;
  return { HANDLERS: handlers };
});

it('throws at load naming a core tool whose handler is missing', async () => {
  await expect(import('../../../src/ops/registry.js')).rejects.toThrow(/world_info.*no handler/);
});
