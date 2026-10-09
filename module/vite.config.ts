import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: '../dist/module',
    emptyOutDir: true,
    lib: { entry: 'src/main.ts', formats: ['es'], fileName: () => 'main.js' },
    sourcemap: true,
  },
});
