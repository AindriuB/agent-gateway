import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'protocol',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.slow.test.ts'],
    environment: 'node',
  },
});
