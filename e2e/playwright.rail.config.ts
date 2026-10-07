import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env['HEYTA_RAIL_PORT'] ?? 4357);

export default defineConfig({
  ...base,
  testMatch: /(?:account-menu|rail-geometry)\.spec\.ts/,
  outputDir: '/tmp/heyta-rail-4357-output',
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
