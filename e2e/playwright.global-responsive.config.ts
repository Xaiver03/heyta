import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env['HEYTA_TASTE_PORT'] ?? '4337');

export default defineConfig({
  testDir: './tests',
  testMatch: /global-responsive-ux\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results-global-responsive',
  timeout: 1_200_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${String(port)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${String(port)} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${String(port)}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
