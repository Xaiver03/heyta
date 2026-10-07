import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testDir: './tests',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4323' },
  webServer: undefined,
});
