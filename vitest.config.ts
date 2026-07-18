import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['packages/*/src/**/*.ts', 'apps/desktop/src/**/*.ts'],
      reporter: ['text', 'html'],
    },
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/performance/**/*.test.ts'],
    passWithNoTests: false,
  },
});
