import { defineConfig } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 15_000,
  },
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: false,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['line']] : 'list',
  retries: process.env.CI ? 2 : 0,
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    trace: 'retain-on-failure',
  },
});
