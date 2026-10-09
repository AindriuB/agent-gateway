import { defineConfig } from 'vitest/config';

// `npm test` runs the protocol, module and gateway projects; `npm run test:slow` runs only
// module-slow (the `*.slow.test.ts` files).
export default defineConfig({
  test: { projects: ['protocol', 'module', 'gateway', 'module/vitest.slow.config.ts'] },
});
