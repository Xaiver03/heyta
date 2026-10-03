/** Real production UI + HTTP/PG. Independent browser contexts are devices;
 * no routes or key APIs are mocked. Only authentication is pre-established.
 */
import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decidePrivacyConsent } from '../tests/helpers';
import { execFileSync } from 'node:child_process';

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
    await shot(a.page, 'pg-01-created');
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
    await shot(b.page, 'pg-04-root-rotated');
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
    await c.page.getByRole('button', { name: 'Switch to dark theme', exact: true }).click();
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

test('migration resumes after a browser restart and cancellation releases real server staging', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  await mkdir(evidence, { recursive: true });
  const email = `vault-resume-${Date.now()}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const headers = { authorization: `Bearer ${account.token}` };
  const a = await device(browser, { baseUrl: api, token: account.token, accountId: String(account.userId), email });
  try {
    await settings(a.page);
    await a.page.getByTestId('vault-create-passphrase').fill(passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    await a.page.getByRole('button', { name: 'Close sync settings' }).click();
    const title = `resume migration task ${Date.now()}`;
    await a.page.locator('input[placeholder^="Add a task"]').fill(title);
    await a.page.locator('input[placeholder^="Add a task"]').press('Enter');
    await a.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(async () => (await (await request.get(`${api}/api/sync/key-migration/inventory`, { headers })).json()).operations.length).toBeGreaterThan(0);
    await settings(a.page);
    await a.page.getByTestId('vault-new-passphrase').fill(rotatedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    let interruptedRequest = '';
    const chunks = `${api}/api/sync/key-migration/*/chunks`;
    // Fail the actual network boundary; no server response or cipher is mocked.
    await a.page.route(chunks, async (route) => {
      interruptedRequest = new URL(route.request().url()).pathname.split('/').at(-2)!;
      await route.abort('internetdisconnected');
    });
    const rotationRecovery = await confirmCode(a.page);
    await shot(a.page, 'pg-resume-network-failure');
    await expect(a.page.getByTestId('vault-error')).toBeVisible();
    expect(interruptedRequest).not.toBe('');
    const status = async (id: string) => {
      const response = await request.get(`${api}/api/sync/key-migration/${id}`, { headers });
      expect(response.status()).toBe(200);
      return response.json();
    };
    expect((await status(interruptedRequest)).state).toBe('STAGING');
    await a.page.unroute(chunks);
    await a.page.reload();
    await settings(a.page);
    await a.page.getByTestId('vault-passphrase').fill(passphrase);
    await a.page.getByTestId('vault-unlock').click();
    await shot(a.page, 'pg-resume-after-restart');
    await expect(a.page.getByTestId('vault-recovery-resume')).toBeVisible();
    await a.page.getByTestId('vault-recovery-confirm').fill(rotationRecovery);
    await a.page.getByTestId('vault-publish').click();
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    expect((await status(interruptedRequest)).state).toBe('PUBLISHED');
    await shot(a.page, 'pg-resume-published');

    // Let PostgreSQL commit, then lose only the response. The host must query
    // that same durable request rather than generate another root transition.
    await a.page.getByTestId('vault-new-passphrase').fill(renewedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    const commits = `${api}/api/sync/key-migration/*/commit`;
    let lostCommitRequest = '';
    await a.page.route(commits, async (route) => {
      lostCommitRequest = new URL(route.request().url()).pathname.split('/').at(-2)!;
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      await route.abort('connectionreset');
    });
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    expect(lostCommitRequest).not.toBe('');
    expect((await status(lostCommitRequest)).state).toBe('PUBLISHED');
    await shot(a.page, 'pg-commit-response-lost');
    await a.page.unroute(commits);

    await a.page.getByTestId('vault-new-passphrase').fill(passphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    let cancelledRequest = '';
    await a.page.route(chunks, async (route) => {
      cancelledRequest = new URL(route.request().url()).pathname.split('/').at(-2)!;
      await route.abort('internetdisconnected');
    });
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-error')).toBeVisible();
    expect(cancelledRequest).not.toBe(interruptedRequest);
    expect((await status(cancelledRequest)).state).toBe('STAGING');
    await a.page.unroute(chunks);
    await a.page.getByTestId('vault-cancel-pending').click();
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    expect((await status(cancelledRequest)).state).toBe('CANCELLED');
    await a.page.reload();
    await settings(a.page);
    await a.page.getByTestId('vault-passphrase').fill(renewedPassphrase);
    await a.page.getByTestId('vault-unlock').click();
    await shot(a.page, 'pg-cancel-after-restart');
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    await expect(a.page.getByTestId('vault-pending')).toHaveCount(0);
  } catch (error) {
    await shot(a.page, 'pg-resume-failure').catch(() => undefined);
    console.error('Resume browser errors', a.errors);
    throw error;
  } finally {
    await a.context.close();
  }
});

test('legacy history survives first vault publication and explicit migration to a new device', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  await mkdir(evidence, { recursive: true });
  const stamp = Date.now();
  const email = `vault-legacy-${stamp}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const headers = { authorization: `Bearer ${account.token}` };
  const credentials = { baseUrl: api, token: account.token, accountId: String(account.userId), email };
  const legacyPassword = 'legacy test encryption passphrase';
  const title = `legacy task before vault ${stamp}`;
  const uploaded = await request.post(`${api}/api/sync/ops`, { headers, data: {
    clientId: 'legacy-device', lastKnownServerSeq: 0,
    ops: [{ id: `legacy-op-${stamp}`, clientId: 'legacy-device', actionType: 'CREATE_TASK', opType: 'CRT',
      entityType: 'TASK', entityId: `legacy-task-${stamp}`, vectorClock: { 'legacy-device': 1 },
      timestamp: stamp, schemaVersion: 1, isPayloadEncrypted: true,
      // Native Node ESM avoids Playwright transforming noble's ESM module graph.
      // The legacy fixture still uses the shipped cipher, through a separate old client.
      payload: execFileSync(process.execPath, ['--input-type=module', '-e',
        `import {readFileSync} from 'node:fs';
         import {encrypt} from ${JSON.stringify(new URL('../../packages/sync-core/dist/index.js', import.meta.url).href)};
         const {payload,password}=JSON.parse(readFileSync(0,'utf8'));
         process.stdout.write(await encrypt(JSON.stringify(payload),password));`,
      ], { input: JSON.stringify({ payload: { title, priority: 0 }, password: legacyPassword }), encoding: 'utf8' }),
    }],
  } });
  expect(uploaded.status()).toBe(200);
  const inventory = await request.get(`${api}/api/sync/key-migration/inventory`, { headers });
  expect(inventory.status()).toBe(200);
  expect((await inventory.json()).operations).toHaveLength(1);
  const a = await device(browser, credentials);
  const devices = [a];
  try {
    await settings(a.page);
    await a.page.getByTestId('vault-create-passphrase').fill(passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const first = await request.get(`${api}/api/sync/key-package`, { headers });
    expect(first.status()).toBe(200);
    expect((await first.json()).payloadKeyVersion).toBeNull();
    await a.page.getByTestId('vault-new-passphrase').fill(rotatedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    await a.page.getByTestId('vault-legacy-passphrase').fill(legacyPassword);
    await confirmCode(a.page);
    await shot(a.page, 'pg-legacy-migration');
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const migrated = await request.get(`${api}/api/sync/key-package`, { headers });
    expect(migrated.status()).toBe(200);
    expect((await migrated.json()).payloadKeyVersion).toBe(1);
    const b = await device(browser, credentials); devices.push(b);
    await settings(b.page);
    await b.page.getByTestId('vault-passphrase').fill(rotatedPassphrase);
    await b.page.getByTestId('vault-unlock').click();
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    await b.page.getByRole('button', { name: 'Close sync settings' }).click();
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(b.page, 'pg-legacy-new-device');
    await expect(b.page.getByText(title, { exact: true }).first()).toBeVisible();
    await shot(b.page, 'pg-legacy-new-device');
  } catch (error) {
    for (const [index, d] of devices.entries()) {
      await shot(d.page, `pg-legacy-failure-${index}`).catch(() => undefined);
      console.error(`Legacy device ${index} browser errors`, d.errors);
    }
    throw error;
  } finally {
    for (const d of devices) await d.context.close().catch(() => undefined);
  }
});
