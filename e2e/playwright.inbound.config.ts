import { defineConfig } from '@playwright/test';
import base from './playwright.config';
const port = 4468;
export default defineConfig({
  ...base,
  testMatch: /inbound-automation\.spec\.ts/,
  retries: 0,
  outputDir: '/tmp/heyta-inbound-ui-results',
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}`, trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' },
  webServer: [{ command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${port} --strictPort`, cwd: '..',
    url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 120_000 }],
});
