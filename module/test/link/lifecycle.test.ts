import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

type Listener = (e: { persisted?: boolean }) => void;
let stub: FoundryStub;
let listeners: Map<string, Listener>;
const startLink = vi.fn();
const stopLink = vi.fn();

beforeEach(async () => {
  vi.resetModules();
  startLink.mockClear();
  stopLink.mockClear();
  vi.doMock('../../src/link/runtime.js', () => ({ startLink, stopLink }));
  stub = installFoundry(14);
  listeners = new Map();
  (globalThis as Record<string, unknown>).addEventListener = (t: string, f: Listener) => {
    listeners.set(t, f);
  };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../../src/main.js');
  stub.fire('init');
  stub.fire('ready');
  startLink.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).addEventListener;
  vi.restoreAllMocks();
  vi.doUnmock('../../src/link/runtime.js');
  stub?.uninstall();
});

it('does not listen for beforeunload (cancelled navigation must not stop the link)', () => {
  expect(listeners.has('beforeunload')).toBe(false);
  expect(stopLink).not.toHaveBeenCalled();
});

it('pagehide stops the link', () => {
  listeners.get('pagehide')!({});
  expect(stopLink).toHaveBeenCalledTimes(1);
});

it('pageshow with persisted restarts the link', () => {
  listeners.get('pageshow')!({ persisted: true });
  expect(startLink).toHaveBeenCalledTimes(1);
});

it('pageshow without persisted does nothing', () => {
  listeners.get('pageshow')!({ persisted: false });
  listeners.get('pageshow')!({});
  expect(startLink).not.toHaveBeenCalled();
  expect(stopLink).not.toHaveBeenCalled();
});
