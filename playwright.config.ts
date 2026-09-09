import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
  },
  reporter: 'line',
});
