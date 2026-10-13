import { defineConfig } from 'vitest/config';

// Two projects. `e2e-unit` is offline (the harness's own checks); `e2e-live` needs the Mac test
// bed. Neither is listed by the root vitest.config.ts. Files and workers run one at a time: one
// gateway link port and one browser per user.
const shared = { fileParallelism: false, maxWorkers: 1, environment: 'node' } as const;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'e2e-unit',
          root: import.meta.dirname,
          include: [
            'run.test.ts',
            'dnd5e/**/*.test.ts',
            'lib/**/*.test.ts',
            'fixtures/**/*.test.ts',
            'setup/**/*.test.ts',
            'multi/**/*.test.ts',
            'takeover/**/*.test.ts',
          ],
          exclude: ['**/*.e2e.test.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          ...shared,
          name: 'e2e-live',
          root: import.meta.dirname,
          include: [
            'read/**/*.e2e.test.ts',
            'multi/**/*.e2e.test.ts',
            'takeover/**/*.e2e.test.ts',
            'packs/**/*.e2e.test.ts',
            'dnd5e/**/*.e2e.test.ts',
            'pf2e/**/*.e2e.test.ts',
            'pf2e-build/**/*.e2e.test.ts',
            'pf2e-embed/**/*.e2e.test.ts',
            'pf2e-choices/**/*.e2e.test.ts',
          ],
          testTimeout: 120_000,
          hookTimeout: 240_000,
        },
      },
    ],
  },
});
