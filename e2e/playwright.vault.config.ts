import { defineConfig, devices } from '@playwright/test';

// Playwright 1.63 otherwise writes a page aria snapshot to error-context.md
// even with trace/video/screenshot disabled. Recovery-code forms are secrets.
// Keep assertion diagnostics, but never capture an unmasked page tree.
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';

/** Isolated ports and result directory: never stop another suite's server.
 * The runner builds a static artifact first. Live edits must not HMR-reset a
 * vault session halfway through a recovery or key migration assertion.
 */
export default defineConfig({
  testDir: './vault', outputDir: './vault-results',
  workers: 1, fullyParallel: false, retries: 0, forbidOnly: !!process.env['CI'],
  timeout: 180_000, expect: { timeout: 20_000 }, reporter: [['list']],
  // Recovery-code forms contain ephemeral test secrets: no traces or video.
  use: { baseURL: 'http://127.0.0.1:4346', actionTimeout: 20_000, trace: 'off', video: 'off', screenshot: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @heyta/web exec vite preview --host 127.0.0.1 --port 4346 --strictPort',
    cwd: '..', url: 'http://127.0.0.1:4346', reuseExistingServer: false, timeout: 120_000,
  },
});
