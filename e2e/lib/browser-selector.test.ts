// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { SELECTORS } from './browser.js';

describe('Foundry join user selector', () => {
  it.each(['userid', 'userId'])('finds the %s control without selecting other fields', (name) => {
    document.body.innerHTML = `<select name="world"><option>Other</option></select>
      <select name="${name}"><option>dev-gm</option><option>Player1</option></select>`;
    const select = document.querySelector<HTMLSelectElement>(SELECTORS.joinUser);
    expect(select?.name).toBe(name);
    expect(Array.from(select?.options ?? [], (option) => option.textContent)).toEqual([
      'dev-gm',
      'Player1',
    ]);
    expect(document.querySelectorAll(SELECTORS.joinUser)).toHaveLength(1);
    expect(
      Array.from(
        document.querySelectorAll(SELECTORS.joinUser + ' option'),
        (option) => option.textContent,
      ),
    ).toEqual(['dev-gm', 'Player1']);
  });
});
