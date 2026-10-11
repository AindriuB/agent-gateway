import type { Page } from 'playwright-core';
export const NATIVE_APPROVAL_SELECTOR = 'article[data-request]';
/** Serialized into the native browser: never clicks or resolves approval controls. */
export function nativeApprovalCardsReady({ selector, count }: { selector: string; count: number }) {
  const cards = [...document.querySelectorAll<HTMLElement>(selector)];
  return (
    cards.length === count &&
    cards.every((card) => {
      const id = card.dataset.request;
      const approve = card.querySelector<HTMLButtonElement>('button[data-action="approve"]');
      return (
        !!id &&
        !!approve &&
        approve.dataset.requestId === id &&
        !approve.disabled &&
        card.getClientRects().length > 0
      );
    })
  );
}
export async function waitForNativeApprovals(page: Pick<Page, 'waitForFunction'>, count: number) {
  await page.waitForFunction(
    nativeApprovalCardsReady,
    { selector: NATIVE_APPROVAL_SELECTOR, count },
    { timeout: 30_000 },
  );
}
