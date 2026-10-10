/**
 * Remove every unrevealed secret (an element whose class list contains `secret` but not `revealed`,
 * as Foundry's TextEditor does for readers without the secrets option), with its subtree, in place. Call it on the DOM of an HTML field before `domToDocument` unless the
 * reader is an OWNER of the document that owns the field, which is what Foundry itself does.
 */
export function stripSecrets(root: Node): void {
  const el = root as Partial<Element>;
  if (typeof el.querySelectorAll !== 'function') return;
  for (const node of Array.from(el.querySelectorAll('[class]'))) {
    if (node.classList.contains('secret') && !node.classList.contains('revealed')) node.remove();
  }
}
