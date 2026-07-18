import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    sourcemap: true,
  },
});
