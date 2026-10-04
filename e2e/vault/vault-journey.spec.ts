import { fillVaultSecret } from './privacy';
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
  // These tests place barriers on real HTTP requests. A service worker can
  // forward them outside Playwright's routing, making fault injection vacuous.
  // PWA behavior has its own gate; this suite exercises the production UI/API.
  const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, serviceWorkers: 'block' });
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
  expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{40}$/u.test(code), 'recovery code format is valid').toBe(true);
  await shot(page, 'pg-pending-confirmation');
  await fillVaultSecret(page.getByTestId('vault-recovery-confirm'), code);
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
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
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
    await fillVaultSecret(b.page.getByTestId('vault-recovery-code'), recovery);
    await b.page.getByTestId('vault-unlock-recovery').click();
    await shot(b.page, 'pg-02-recovery-requires-rotation');
    await expect(b.page.getByTestId('vault-recovery-rotation')).toBeVisible();
    await expect(b.page.getByTestId('vault-ready')).toHaveCount(0);
    await fillVaultSecret(b.page.getByTestId('vault-new-passphrase'), renewedPassphrase);
    await b.page.getByTestId('vault-change-passphrase').click();
    await confirmCode(b.page);
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    await b.page.getByRole('button', { name: 'Close sync settings' }).click();
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(b.page, 'pg-03-restored-task');
    await expect(b.page.getByText(title, { exact: true }).first()).toBeVisible();

    await settings(b.page);
    await fillVaultSecret(b.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
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
    await fillVaultSecret(c.page.getByTestId('vault-passphrase'), rotatedPassphrase);
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
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
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
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
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
    await fillVaultSecret(a.page.getByTestId('vault-passphrase'), passphrase);
    await a.page.getByTestId('vault-unlock').click();
    await shot(a.page, 'pg-resume-after-restart');
    await expect(a.page.getByTestId('vault-recovery-resume')).toBeVisible();
    await fillVaultSecret(a.page.getByTestId('vault-recovery-confirm'), rotationRecovery);
    await a.page.getByTestId('vault-publish').click();
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    expect((await status(interruptedRequest)).state).toBe('PUBLISHED');
    await shot(a.page, 'pg-resume-published');

    // Let PostgreSQL commit, then lose only the response. The host must query
    // that same durable request rather than generate another root transition.
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), renewedPassphrase);
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

    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), passphrase);
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
    await fillVaultSecret(a.page.getByTestId('vault-passphrase'), renewedPassphrase);
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

test('a task added during root migration syncs with the new generation after publication', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  const email = `vault-concurrent-${Date.now()}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const headers = { authorization: `Bearer ${account.token}` };
  const credentials = { baseUrl: api, token: account.token, accountId: String(account.userId), email };
  const a = await device(browser, credentials);
  const devices = [a];
  let releaseInventory = () => {};
  try {
    await settings(a.page);
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    let inventorySeen = false;
    const inventoryRelease = new Promise<void>((resolve) => { releaseInventory = resolve; });
    const inventoryRoute = `${api}/api/sync/key-migration/inventory**`;
    await a.page.route(inventoryRoute, async (route) => {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      inventorySeen = true;
      await inventoryRelease;
      await route.fulfill({ response: actual });
    });
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    await confirmCode(a.page);
    await expect.poll(() => inventorySeen, { message: 'production migration reached the inventory barrier' }).toBe(true);
    await a.page.getByRole('button', { name: 'Close sync settings' }).click();
    const title = `task created during migration ${Date.now()}`;
    await a.page.locator('input[placeholder^="Add a task"]').fill(title);
    await a.page.locator('input[placeholder^="Add a task"]').press('Enter');
    await expect(a.page.getByText(title, { exact: true }).first()).toBeVisible();
    await a.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(a.page, 'pg-concurrent-local-task');
    // The local edit must remain responsive while its network upload waits.
    const during = await request.get(`${api}/api/sync/key-migration/inventory`, { headers });
    expect(during.status()).toBe(200);
    expect((await during.json()).operations).toHaveLength(0);
    releaseInventory();
    await expect.poll(async () => (await (await request.get(`${api}/api/sync/key-package`, { headers })).json()).payloadKeyVersion).toBe(2);
    await expect.poll(async () => (await (await request.get(`${api}/api/sync/key-migration/inventory`, { headers })).json()).operations.length).toBe(1);
    const b = await device(browser, credentials); devices.push(b);
    await settings(b.page);
    await fillVaultSecret(b.page.getByTestId('vault-passphrase'), rotatedPassphrase);
    await b.page.getByTestId('vault-unlock').click();
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    await b.page.getByRole('button', { name: 'Close sync settings' }).click();
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(b.page, 'pg-concurrent-new-device');
    await expect(b.page.getByText(title, { exact: true }).first()).toBeVisible();
    await shot(b.page, 'pg-concurrent-new-device');
  } catch (error) {
    await shot(a.page, 'pg-concurrent-failure').catch(() => undefined);
    console.error('Concurrent browser errors', a.errors);
    throw error;
  } finally {
    releaseInventory();
    for (const d of devices) await d.context.close().catch(() => undefined);
  }
});

test('a reload after server commit restores the unpublished local root and clears its journal', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  const email = `vault-commit-crash-${Date.now()}@test.local`;
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: 'Auth-test-only-928!' } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const headers = { authorization: `Bearer ${account.token}` };
  const a = await device(browser, { baseUrl: api, token: account.token, accountId: String(account.userId), email });
  let releaseCommit = () => {};
  try {
    await settings(a.page);
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const holdCommit = new Promise<void>((resolve) => { releaseCommit = resolve; });
    let committedRequest = '';
    const commitRoute = `${api}/api/sync/key-migration/*/commit`;
    await a.page.route(commitRoute, async (route) => {
      const actual = await route.fetch();
      expect(actual.status()).toBe(200);
      committedRequest = new URL(route.request().url()).pathname.split('/').at(-2)!;
      await holdCommit;
      await route.abort('connectionreset').catch(() => undefined);
    });
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    const recovery = await confirmCode(a.page);
    await expect.poll(() => committedRequest, { message: 'PostgreSQL committed before browser restart' }).not.toBe('');
    const state = await request.get(`${api}/api/sync/key-migration/${committedRequest}`, { headers });
    expect((await state.json()).state).toBe('PUBLISHED');
    await shot(a.page, 'pg-commit-before-restart');
    await a.page.reload();
    releaseCommit();
    await a.page.unroute(commitRoute);
    await settings(a.page);
    await fillVaultSecret(a.page.getByTestId('vault-passphrase'), passphrase);
    await a.page.getByTestId('vault-unlock').click();
    await shot(a.page, 'pg-commit-restart-recovery');
    await expect(a.page.getByTestId('vault-recovery-resume')).toBeVisible();
    await fillVaultSecret(a.page.getByTestId('vault-recovery-confirm'), recovery);
    await a.page.getByTestId('vault-publish').click();
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    // A second migration proves that the first journal was acknowledged after
    // local installation, rather than silently left to block future rotations.
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), renewedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    await confirmCode(a.page);
    await shot(a.page, 'pg-commit-restart-next-rotation');
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const current = await request.get(`${api}/api/sync/key-package`, { headers });
    expect((await current.json()).payloadKeyVersion).toBe(3);
  } catch (error) {
    await shot(a.page, 'pg-commit-restart-failure').catch(() => undefined);
    console.error('Commit restart browser errors', a.errors);
    throw error;
  } finally {
    releaseCommit();
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
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const first = await request.get(`${api}/api/sync/key-package`, { headers });
    expect(first.status()).toBe(200);
    expect((await first.json()).payloadKeyVersion).toBeNull();
    await fillVaultSecret(a.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
    await a.page.getByTestId('vault-rotate-root').click();
    await fillVaultSecret(a.page.getByTestId('vault-legacy-passphrase'), legacyPassword);
    await confirmCode(a.page);
    await shot(a.page, 'pg-legacy-migration');
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    const migrated = await request.get(`${api}/api/sync/key-package`, { headers });
    expect(migrated.status()).toBe(200);
    expect((await migrated.json()).payloadKeyVersion).toBe(1);
    const b = await device(browser, credentials); devices.push(b);
    await settings(b.page);
    await fillVaultSecret(b.page.getByTestId('vault-passphrase'), rotatedPassphrase);
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

// This is intentionally a product journey, not a direct DELETE-only API test:
// the setting must be reachable, every old session must stop, and rotating the
// root must reject a real pending write encrypted by the removed device.
test('device settings revoke every old session, then trusted reauthentication and rotation reject an old-key write', async ({ browser, request }) => {
  if (!api) throw new Error('Run scripts/verify-vault-web-journey.mjs');
  await mkdir(evidence, { recursive: true });
  const stamp = Date.now();
  const email = `vault-revoke-${stamp}@test.local`;
  const authPassword = 'Auth-test-only-928!';
  const created = await request.post(`${api}/api/test/create-user`, { data: { email, password: authPassword } });
  expect(created.status()).toBe(201);
  const account = await created.json() as { token: string; userId: number };
  const credentials = { baseUrl: api, token: account.token, accountId: String(account.userId), email };
  const oldHeaders = { authorization: `Bearer ${account.token}` };
  const a = await device(browser, credentials);
  const devices = [a];
  const title = `retained after device revoke ${stamp}`;
  let pendingBody: { clientId: string; ops: Array<{ id: string; isPayloadEncrypted: boolean }> } | undefined;
  try {
    await settings(a.page);
    await fillVaultSecret(a.page.getByTestId('vault-create-passphrase'), passphrase);
    await a.page.getByTestId('vault-create').click();
    await confirmCode(a.page);
    await expect(a.page.getByTestId('vault-ready')).toBeVisible();
    await a.page.getByRole('button', { name: 'Close sync settings' }).click();
    await a.page.locator('input[placeholder^="Add a task"]').fill(title);
    await a.page.locator('input[placeholder^="Add a task"]').press('Enter');
    await a.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(async () => {
      const response = await request.get(`${api}/api/sync/key-migration/inventory`, { headers: oldHeaders });
      expect(response.status()).toBe(200);
      return ((await response.json()) as { operations: unknown[] }).operations.length;
    }).toBeGreaterThan(0);

    const originalPackageResponse = await request.get(`${api}/api/sync/key-package`, { headers: oldHeaders });
    expect(originalPackageResponse.status()).toBe(200);
    const originalPackage = await originalPackageResponse.json() as { package: { rootKeyFingerprint: string } };

    const b = await device(browser, credentials); devices.push(b);
    await settings(b.page);
    await fillVaultSecret(b.page.getByTestId('vault-passphrase'), passphrase);
    await b.page.getByTestId('vault-unlock').click();
    await expect(b.page.getByTestId('vault-ready')).toBeVisible();
    await b.page.getByRole('button', { name: 'Close sync settings' }).click();
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect(b.page.getByText(title, { exact: true }).first()).toBeVisible();

    // Observe a real authenticated server connection, including its connected
    // acknowledgement; an open TCP upgrade alone would race authentication.
    await b.page.evaluate(async ({ base, token, id }) => {
      const state = { closeCode: 0 };
      (globalThis as unknown as { __vaultRevocationSocket: typeof state }).__vaultRevocationSocket = state;
      const url = new URL('/api/sync/ws', base);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('token', token); url.searchParams.set('clientId', id);
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => { ws.close(); reject(new Error('Missing authenticated socket acknowledgement')); }, 10_000);
        ws.onclose = (event) => { state.closeCode = event.code; };
        ws.onerror = () => { clearTimeout(timer); reject(new Error('Authenticated socket failed')); };
        ws.onmessage = (event) => {
          const value = JSON.parse(String(event.data)) as { type?: string };
          if (value.type === 'connected') { clearTimeout(timer); resolve(); }
          if (value.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
        };
      });
    }, { base: api, token: account.token, id: `revoke-observer-${stamp}` });

    // Hold back an actual encrypted upload from B. No fabricated payload or
    // manually edited generation can stand in for a former device's write.
    await b.page.route(`${api}/api/sync/ops`, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      pendingBody = route.request().postDataJSON() as typeof pendingBody;
      await route.abort('internetdisconnected');
    });
    await b.page.locator('input[placeholder^="Add a task"]').fill(`offline removed-device task ${stamp}`);
    await b.page.locator('input[placeholder^="Add a task"]').press('Enter');
    await b.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await expect.poll(() => pendingBody?.ops.length ?? 0).toBeGreaterThan(0);
    const stale = pendingBody!;
    expect(stale.ops.every((op) => op.isPayloadEncrypted)).toBe(true);
    const before = await request.get(`${api}/api/sync/key-migration/inventory`, { headers: oldHeaders });
    expect(before.status()).toBe(200);
    const beforeIds = ((await before.json()) as { operations: Array<{ id: string }> }).operations.map((op) => op.id);
    expect(stale.ops.every((op) => !beforeIds.includes(op.id))).toBe(true);

    await settings(a.page);
    const removeButton = a.page.getByTestId(`vault-device-revoke-${stale.clientId}`);
    await shot(a.page, 'pg-device-list-before-revoke');
    await expect(removeButton).toBeVisible();
    let confirmation = '';
    a.page.once('dialog', async (dialog) => { confirmation = dialog.message(); await dialog.accept(); });
    const deletion = a.page.waitForResponse((response) => response.request().method() === 'DELETE' && response.url().endsWith(`/api/sync/devices/${encodeURIComponent(stale.clientId)}`));
    await removeButton.click();
    expect((await deletion).status()).toBe(200);
    expect(confirmation).toMatch(/all|every/iu);
    await expect.poll(() => b.page.evaluate(() => (globalThis as unknown as { __vaultRevocationSocket: { closeCode: number } }).__vaultRevocationSocket.closeCode)).toBe(4003);
    await shot(a.page, 'pg-device-revoked-signin-required');
    await expect(a.page.getByTestId('vault-ready')).toHaveCount(0);
    expect((await request.get(`${api}/api/sync/key-package`, { headers: oldHeaders })).status()).toBe(401);
    expect((await request.post(`${api}/api/sync/ops`, { headers: oldHeaders, data: stale })).status()).toBe(401);

    // Reauthenticate through the production password endpoint. Authentication
    // still cannot decrypt: C must separately unlock with the old passphrase.
    const login = await request.post(`${api}/api/login/email-password`, { data: { email, password: authPassword } });
    expect(login.status()).toBe(200);
    const signedIn = await login.json() as { token: string };
    const newHeaders = { authorization: `Bearer ${signedIn.token}` };
    const c = await device(browser, { ...credentials, token: signedIn.token }); devices.push(c);
    await settings(c.page);
    await expect(c.page.getByTestId('vault-unlock-form')).toBeVisible();
    await fillVaultSecret(c.page.getByTestId('vault-passphrase'), passphrase);
    await c.page.getByTestId('vault-unlock').click();
    await expect(c.page.getByTestId('vault-ready')).toBeVisible();
    await fillVaultSecret(c.page.getByTestId('vault-new-passphrase'), rotatedPassphrase);
    await c.page.getByTestId('vault-rotate-root').click();
    await confirmCode(c.page);
    await expect(c.page.getByTestId('vault-ready')).toBeVisible();
    const active = await request.get(`${api}/api/sync/key-package`, { headers: newHeaders });
    expect(active.status()).toBe(200);
    const activePackage = await active.json() as { package: { rootKeyFingerprint: string }; payloadKeyVersion: number };
    expect(activePackage.payloadKeyVersion).toBe(2);
    expect(activePackage.package.rootKeyFingerprint).not.toBe(originalPackage.package.rootKeyFingerprint);
    await c.page.getByRole('button', { name: 'Close sync settings' }).click();
    await c.page.getByRole('button', { name: 'Sync now', exact: true }).click();
    await shot(c.page, 'pg-device-rotation-restored-task');
    await expect(c.page.getByText(title, { exact: true }).first()).toBeVisible();

    const staleUpload = await request.post(`${api}/api/sync/ops`, { headers: newHeaders, data: stale });
    expect(staleUpload.status()).toBe(200);
    const rejected = await staleUpload.json() as { results: Array<{ opId: string; accepted: boolean; errorCode: string }> };
    expect(rejected.results).toHaveLength(stale.ops.length);
    for (const op of stale.ops) expect(rejected.results.find((result) => result.opId === op.id)).toMatchObject({ accepted: false, errorCode: 'E2EE_REQUIRED' });
    const after = await request.get(`${api}/api/sync/key-migration/inventory`, { headers: newHeaders });
    expect(after.status()).toBe(200);
    const afterIds = ((await after.json()) as { operations: Array<{ id: string }> }).operations.map((op) => op.id);
    expect(stale.ops.every((op) => !afterIds.includes(op.id))).toBe(true);
  } catch (error) {
    for (const [index, d] of devices.entries()) {
      await shot(d.page, `pg-revoke-failure-device-${index}`).catch(() => undefined);
      // Keep endpoint query strings and credentials out of failure output.
      console.error(`Revocation device ${index}: ${d.errors.length} browser errors`);
    }
    throw error;
  } finally {
    for (const d of devices) await d.context.close().catch(() => undefined);
  }
});
