import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installFoundry, type FoundryStub } from '../stubs/foundry.js';

type Listener = (e: { persisted?: boolean }) => void;
let stub: FoundryStub;
let listeners: Map<string, Listener>;
let counts: Map<string, number>;
let active = true;
const startLink = vi.fn();
const stopLink = vi.fn();
const resumeLink = vi.fn();
const isLinkActive = () => active;

beforeEach(async () => {
  vi.resetModules();
  startLink.mockClear();
  stopLink.mockClear();
  resumeLink.mockClear();
  vi.doMock('../../src/link/runtime.js', () => ({
    startLink,
    stopLink,
    resumeLink,
    isLinkActive,
  }));
  stub = installFoundry(14);
  listeners = new Map();
  counts = new Map();
  active = true;
  (globalThis as Record<string, unknown>).addEventListener = (t: string, f: Listener) => {
    counts.set(t, (counts.get(t) ?? 0) + 1);
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

it('registers exactly one pagehide and one pageshow listener', () => {
  expect([...counts.entries()].sort()).toEqual(
    [
      ['pageshow', 1],
      ['pagehide', 1],
    ].sort(),
  );
});

it('pageshow with persisted resumes the link (not a fresh start)', () => {
  listeners.get('pagehide')!({});
  listeners.get('pageshow')!({ persisted: true });
  expect(resumeLink).toHaveBeenCalledTimes(1);
  expect(startLink).not.toHaveBeenCalled();
});

it('pageshow without persisted does nothing', () => {
  listeners.get('pageshow')!({ persisted: false });
  listeners.get('pageshow')!({});
  expect(startLink).not.toHaveBeenCalled();
  expect(stopLink).not.toHaveBeenCalled();
});

it('pageshow persisted does not restart a link that was inactive at pagehide', () => {
  active = false;
  listeners.get('pagehide')!({});
  listeners.get('pageshow')!({ persisted: true });
  expect(startLink).not.toHaveBeenCalled();
  expect(resumeLink).not.toHaveBeenCalled();
});

it('pagehide does not stop an inactive (replaced) link, so its REPLACED state survives', () => {
  active = false;
  listeners.get('pagehide')!({ persisted: true });
  listeners.get('pageshow')!({ persisted: true });
  expect(stopLink).not.toHaveBeenCalled();
  expect(startLink).not.toHaveBeenCalled();
});
