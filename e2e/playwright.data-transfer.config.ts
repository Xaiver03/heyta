import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: /data-transfer-ux\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: '/tmp/heyta-data-transfer-final',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4356', locale: 'zh-CN' },
  webServer: {
    command: 'pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port 4356 --strictPort',
    cwd: '..', url: 'http://127.0.0.1:4356', reuseExistingServer: false,
  },
});
