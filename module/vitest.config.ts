import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'module', include: ['test/**/*.test.ts'], environment: 'node' },
});
