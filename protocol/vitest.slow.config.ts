import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'protocol-slow', include: ['test/**/*.slow.test.ts'], environment: 'node' },
});
