import type { Locator } from '@playwright/test';

// Also applies to the vault-settings fixture under the general E2E config.
// Automatic aria snapshots are not masked by page.screenshot({ mask: ... }).
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';

/** Playwright's fill failure log can include the submitted value. */
export async function fillVaultSecret(input: Locator, value: string): Promise<void> {
  try {
    await input.fill(value);
  } catch {
    throw new Error('Vault secret entry failed; value omitted from diagnostics');
  }
}
