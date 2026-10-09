// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { domToMarkdown } from '../../src/serialise/index.js';

describe('large tables', () => {
  it('converts a 150k-row table without throwing', () => {
    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    for (let i = 0; i < 150000; i++) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.textContent = 'r';
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const md = domToMarkdown(table);
    expect(md.split('\n').length).toBeGreaterThan(150000);
  }, 60000);
});
