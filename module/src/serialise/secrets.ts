/**
 * Remove every element whose class list contains `secret` (Foundry's GM secret sections), with
 * its subtree, in place. Call it on the DOM of an HTML field before `domToDocument` unless the
 * reader is an OWNER of the document that owns the field, which is what Foundry itself does.
 */
export function stripSecrets(root: Node): void {
  const el = root as Partial<Element>;
  if (typeof el.querySelectorAll !== 'function') return;
  for (const node of Array.from(el.querySelectorAll('[class]'))) {
    if (node.classList.contains('secret')) node.remove();
  }
}
