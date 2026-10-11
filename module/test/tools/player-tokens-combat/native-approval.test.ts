// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  NATIVE_APPROVAL_SELECTOR,
  nativeApprovalCardsReady,
  waitForNativeApprovals,
} from './native-approval.js';
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
it('uses the actual current HBS request attribute rather than the obsolete class', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../../../../templates/approval/approval.hbs'),
    'utf8',
  );
  document.body.innerHTML = source;
  expect(document.querySelectorAll(NATIVE_APPROVAL_SELECTOR)).toHaveLength(1);
  expect(document.querySelector('article.request')).toBeNull();
  expect(
    document.querySelector(`${NATIVE_APPROVAL_SELECTOR} button[data-action="approve"]`),
  ).not.toBeNull();
});
it('requires all five then one visible request cards with enabled matching controls', () => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  const card = (id: number) =>
    `<article data-request="request-${id}"><button data-action="approve" data-request-id="request-${id}"></button></article>`;
  document.body.innerHTML = Array.from({ length: 5 }, (_, i) => card(i)).join('');
  const ready = (count: number) =>
    nativeApprovalCardsReady({ selector: NATIVE_APPROVAL_SELECTOR, count });
  expect(ready(5)).toBe(true);
  expect(ready(1)).toBe(false);
  const button = document.querySelector('button')!;
  button.disabled = true;
  expect(ready(5)).toBe(false);
  button.disabled = false;
  button.dataset.requestId = 'other';
  expect(ready(5)).toBe(false);
  document.body.innerHTML = card(5);
  expect(ready(1)).toBe(true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
  expect(ready(1)).toBe(false);
});
it('the real harness wait uses the same tested function and bounded exact count', async () => {
  const waitForFunction = vi.fn(async () => ({}));
  await waitForNativeApprovals({ waitForFunction } as never, 5);
  expect(waitForFunction).toHaveBeenCalledWith(
    nativeApprovalCardsReady,
    { selector: NATIVE_APPROVAL_SELECTOR, count: 5 },
    { timeout: 30_000 },
  );
});
