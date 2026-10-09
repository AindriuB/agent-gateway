import { defineProject } from 'vitest/config';

// Fast suite: everything except `*.slow.test.ts` (run by vitest.slow.config.ts).
export default defineProject({
  test: {
    name: 'module',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.slow.test.ts'],
    environment: 'node',
  },
});
