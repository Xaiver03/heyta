import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/** Current habit interactions, isolated from other UI evidence and dev servers. */
const port = 4358;
export default defineConfig({
  ...base,
  testMatch: /(?:detail-pane-habit|habit-counted-amount|habit-create-options|habit-frequency|habit-icon-picker|habit-month|habit-year)\.spec\.ts/,
  outputDir: '/tmp/heyta-habit-final-output',
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: [
    {
      command: 'node stub-provider.mjs',
      url: 'http://127.0.0.1:4319/__requests',
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 30_000,
    },
    {
      command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${port} --strictPort`,
      cwd: '..',
      url: `http://127.0.0.1:${port}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
