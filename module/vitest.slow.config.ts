import { defineProject } from 'vitest/config';

// Slow suite: scaling oracles, full paging/markdown sweeps. Files are named `*.slow.test.ts`.
export default defineProject({
  test: { name: 'module-slow', include: ['test/**/*.slow.test.ts'], environment: 'node' },
});
