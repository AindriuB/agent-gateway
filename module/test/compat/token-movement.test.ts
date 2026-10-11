/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveTokenCompat } from '../../src/compat/index.js';
import { setup } from '../tools/player-tokens-combat/fixtures.js';
let f: ReturnType<typeof setup>;
afterEach(() => f?.restore());
describe.each([13, 14] as const)('native movement compat v%i', (generation) => {
  beforeEach(() => {
    f = setup(generation);
  });
  it.each([true, false])(
    'preserves native completed=%s and audit update options',
    async (completed) => {
      const options = { agentGateway: { callId: 'audited' } };
      const waypoints = [
        { x: 100, y: 200 },
        { x: 300, y: 400 },
      ];
      const nativeUpdate = vi.fn(async () => completed);
      const scene = {
        moveTokens: vi.fn(async (instructions: any, opts: any) => ({
          t: await nativeUpdate(instructions.t.waypoints, opts),
        })),
      };
      const token = {
        id: 't',
        move: vi.fn(async (path: any, opts: any) =>
          generation === 13
            ? nativeUpdate({ movement: { t: { waypoints: path } } }, opts)
            : (await scene.moveTokens({ t: { waypoints: path } }, opts)).t,
        ),
      };
      expect(await moveTokenCompat(token, waypoints, options)).toBe(completed);
      expect(nativeUpdate.mock.calls[0]?.[1]).toBe(options);
      expect(token.move).toHaveBeenCalledWith(waypoints, options);
    },
  );
  it('does not resolve while native movement is paused', async () => {
    let finish!: (v: boolean) => void;
    const move = vi.fn(
      () =>
        new Promise<boolean>((r) => {
          finish = r;
        }),
    );
    let settled = false;
    const result = moveTokenCompat({ move }, [{ x: 1, y: 2 }], {
      agentGateway: { callId: 'a' },
    }).then((v) => {
      settled = true;
      return v;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(false);
    expect(await result).toBe(false);
  });
  it('rejects missing movement and unknown native results', async () => {
    await expect(moveTokenCompat({}, [], {})).rejects.toThrow();
    await expect(
      moveTokenCompat({ move: async () => undefined }, [{ x: 1, y: 1 }], {}),
    ).rejects.toThrow();
  });
});
