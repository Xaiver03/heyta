/** Real production UI + HTTP/PG. Independent browser contexts are devices;
 * no routes or key APIs are mocked. Only authentication is pre-established.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decidePrivacyConsent } from '../tests/helpers';

const api = process.env['HEYTA_VAULT_TEST_SERVER'];
const evidence = fileURLToPath(new URL('../../apps/web/evidence/vault-panel/', import.meta.url));
const passphrase = 'vault test initial passphrase';
const renewedPassphrase = 'vault test recovered passphrase';
const rotatedPassphrase = 'vault test rotated passphrase';

async function device(browser: Browser, credentials: { baseUrl: string; token: string; accountId: string; email: string }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript((value) => localStorage.setItem('heyta.sync.credentials', JSON.stringify(value)), credentials);
  await page.goto('/?lang=en');
  await decidePrivacyConsent(page, 'accepted');
  return { context, page, errors };
}

async function settings(page: Page) {
  await page.getByRole('button', { name: 'Sync settings', exact: true }).click();
  return page.getByRole('dialog', { name: 'Sync settings', exact: true });
}

async function confirmCode(page: Page) {
  const pending = page.getByTestId('vault-recovery-display');
  await expect(pending).toBeVisible();
  const code = (await pending.textContent())!;
  expect(code).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{40}$/u);
  await shot(page, 'pg-pending-confirmation');
  await page.getByTestId('vault-recovery-confirm').fill(code);
  await page.getByTestId('vault-publish').click();
  return code;
}

async function shot(page: Page, name: string) {
  // Never publish even synthetic recovery secrets in durable evidence.
  await page.screenshot({ path: `${evidence}${name}.png`, mask: [
    page.getByTestId('vault-recovery-display'), page.getByTestId('vault-recovery-code'),
    page.getByTestId('vault-recovery-confirm'),
  ] });
}

test('three devices recover, rotate root, and rebuild tasks from the migrated server history', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  await mkdir(evidence, { recursive: true });
  const email = `vault-ui-${Date.now()}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const credentials = { baseUrl: api, token: account.token, accountId: String(account.userId), email };
  const a = await device(browser, credentials);
  const devices = [a];
  try {
    await settings(a.page);
    await a.page.getByTestId('vault-create-passphrase').fill(passphrase);
    await a.page.getByTestId('vault-create').click();
    const recovery = await confirmCode(a.page);
    await shot(a.page, 'pg-01-created');
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    await a.page.getByRole('button', { name: 'Close sync settings' }).click();
    const title = `vault real task ${Date.now()}`;
    await a.page.locator('input[placeholder^="Add a task"]').fill(title);
    await a.page.locator('input[placeholder^="Add a task"]').press('Enter');
    await a.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(async () => {
      const response = await request.get(`${api}/api/sync/key-migration/inventory`, { headers: { authorization: `Bearer ${account.token}` } });
      expect(response.status()).toBe(200);
      const data = await response.json() as { operations: unknown[] };
      return data.operations.length;
    }).toBeGreaterThan(0);

    const b = await device(browser, credentials); devices.push(b);
    await settings(b.page);
    await b.page.getByTestId('vault-recovery-code').fill(recovery);
    await b.page.getByTestId('vault-unlock-recovery').click();
    await shot(b.page, 'pg-02-recovery-requires-rotation');
    await expect(b.page.getByTestId('vault-recovery-rotation')).toBeVisible();
    await expect(b.page.getByTestId('vault-ready')).toHaveCount(0);
    await b.page.getByTestId('vault-new-passphrase').fill(renewedPassphrase);
    await b.page.getByTestId('vault-change-passphrase').click();
    await confirmCode(b.page);
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    await b.page.getByRole('button', { name: 'Close sync settings' }).click();
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(b.page, 'pg-03-restored-task');
    await expect(b.page.getByText(title, { exact: true }).first()).toBeVisible();

    await settings(b.page);
    await b.page.getByTestId('vault-new-passphrase').fill(rotatedPassphrase);
    await b.page.getByTestId('vault-rotate-root').click();
    await confirmCode(b.page);
    await shot(b.page, 'pg-04-root-rotated');
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    const packageResponse = await request.get(`${api}/api/sync/key-package`, { headers: { authorization: `Bearer ${account.token}` } });
    expect(packageResponse.status()).toBe(200);
    const active = await packageResponse.json() as { package: { keyVersion: number }; payloadKeyVersion: number };
    expect(active.package.keyVersion).toBe(3);
    expect(active.payloadKeyVersion).toBe(2);

    const c = await device(browser, credentials); devices.push(c);
    await settings(c.page);
    await c.page.getByTestId('vault-passphrase').fill(rotatedPassphrase);
    await c.page.getByTestId('vault-unlock').click();
    await expect(c.page.getByTestId('vault-ready')).toBeVisible();
    await c.page.getByRole('button', { name: 'Close sync settings' }).click();
    await c.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await c.page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await shot(c.page, 'pg-05-new-device-after-rotation-dark');
    await expect(c.page.getByText(title, { exact: true }).first()).toBeVisible();
  } catch (error) {
    for (const [index, d] of devices.entries()) {
      await shot(d.page, `pg-failure-device-${index}`).catch(() => undefined);
      console.error(`Device ${index} browser errors`, d.errors);
    }
    throw error;
  } finally {
    for (const d of devices) await d.context.close().catch(() => undefined);
  }
});
