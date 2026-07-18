import { defineConfig } from 'vite';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  // Electron Forge starts Vite before Electron can enforce its single-instance
  // lock. Isolating each server prevents an accidental second `pnpm dev` from
  // replacing the dependency graph underneath the first renderer.
  cacheDir:
    process.env.FRC_FRAMEWORK_VITE_CACHE_DIR ??
    resolve(tmpdir(), 'frc-framework-vite', String(process.pid)),
  // Interrupted Electron/Vite runs can leave a valid-looking but incomplete
  // optimized dependency graph. Rebuilding it on a development launch is a
  // small startup cost and prevents intermittent blank/error windows.
  optimizeDeps: { force: true },
  build: {
    emptyOutDir: true,
    outDir: resolve(__dirname, '.vite/renderer/main_window'),
    sourcemap: true,
  },
});
