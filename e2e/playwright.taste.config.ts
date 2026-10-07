import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const port = Number(process.env['HEYTA_TASTE_PORT'] ?? 4322);

/** UI-only visual review does not call an AI provider or share other runs' ports. */
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: `pnpm --filter @heyta/web exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: '..',
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
