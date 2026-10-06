import { fillVaultSecret } from '../vault/privacy';
/**
 * B · Web vault settings (real Chromium, real Vite app, HTTP fixture).
 *
 * The browser, IndexedDB, Argon2/AES code and React UI are real. The HTTP
 * fixture replaces only the server/Prisma boundary because the default e2e
 * webServer has no PostgreSQL service. This is therefore UI + browser storage
 * evidence, not a claim about the PostgreSQL integration tests.
 *
 * Every state screenshot is written before its assertions. The light and dark
 * images are fixed evidence files so a reviewer can inspect the rendered UI.
 */
import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { decidePrivacyConsent, enableAllModules, stubLegalRecheck, stubPublicFacts, switchTheme } from './helpers';
import { installMissingProducerShims } from './shims';

const SERVER = 'http://sync.vault.e2e.test';
const ACCOUNT_ID = 'vault-browser-account-1';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const EVIDENCE = `${ROOT}apps/web/evidence/vault-panel`;

// Even synthetic recovery codes should not be retained in traces or videos.
// This test replaces HTTP with page.route; a production Service Worker would
// own those fetches instead. PWA worker behavior has its own dedicated suite.
test.use({ trace: 'off', video: 'off', screenshot: 'off', serviceWorkers: 'block' });
async function screenshot(page: Page, filename: string): Promise<void> {
  await page.screenshot({ path: `${EVIDENCE}/${filename}`, fullPage: false, mask: [
    page.getByTestId('vault-recovery-display'), page.getByTestId('vault-recovery-code'),
    page.getByTestId('vault-recovery-confirm'),
  ] });
}
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await screenshot(page, 'fixture-failure.png');
});

async function seedCredentials(page: Page): Promise<void> {
  await page.addInitScript(({ server, accountId }) => {
    localStorage.setItem('heyta.sync.credentials', JSON.stringify({
      baseUrl: server,
      token: 'vault-browser-token',
      email: 'vault@example.test',
      accountId,
    }));
  }, { server: SERVER, accountId: ACCOUNT_ID });
}

async function installHttpFixture(page: Page): Promise<{
  getCount: () => number;
  putCount: () => number;
  published: () => Record<string, unknown> | undefined;
  unexpected: () => string[];
}> {
  let getCount = 0;
  let putCount = 0;
  let packageData: Record<string, unknown> | undefined;
  const unexpected: string[] = [];

  await page.route(`${SERVER}/**`, (route) => {
    const url = new URL(route.request().url());
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${SERVER}/api/sync/key-package`, async (route) => {
    if (route.request().method() === 'GET') {
      getCount += 1;
      if (packageData === undefined) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ package: packageData, payloadKeyVersion: 1 }),
        });
      }
      return;
    }
    if (route.request().method() === 'PUT') {
      putCount += 1;
      const body = route.request().postDataJSON() as { package?: Record<string, unknown> };
      packageData = body.package;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ package: packageData, payloadKeyVersion: 1 }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SERVER}/api/account/profile**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ displayName: null, avatarHash: null }) }));
  await page.route(`${SERVER}/api/sync/devices`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ devices: [] }) }));
  await page.route(`${SERVER}/api/sync/status**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ latestSeq: 0 }) }));
  await page.route(`${SERVER}/api/sync/ops**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], latestSeq: 0 }) }));
  await page.route(`${SERVER}/api/notifications**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [], unreadCount: 0 }) }));
  await page.route(`${SERVER}/api/activity**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaigns: [] }) }));
  await page.route(`${SERVER}/api/passkeys**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passkeys: [] }) }));
  await page.route(`${SERVER}/api/admin/overview`, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) }));
  await stubLegalRecheck(page, SERVER);
  // 🔴 W4b 的开机拉取不在这个主题里，但它确实会发：不登记就被 catch-all 计入
  // `unexpected`，而这条判据红起来读起来像"密钥面坏了"。
  await stubPublicFacts(page, SERVER);
  await page.routeWebSocket('ws://sync.vault.e2e.test/**', () => undefined);

  // The fixture is deliberately strict. A new endpoint must be added here
  // before this test is allowed to call it.
  page.on('request', (request) => {
    if (request.url().startsWith(SERVER) && request.url().includes('/api/sync/key-package')) return;
  });
  return {
    getCount: () => getCount,
    putCount: () => putCount,
    published: () => packageData,
    unexpected: () => unexpected,
  };
}

async function storageDump(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const local = localStorage.getItem('heyta.sync.credentials') ?? '';
    const dbs = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    const db = dbs.some((item) => item.name === 'heyta-vault') ? await new Promise<IDBDatabase | undefined>((resolve) => {
      const request = indexedDB.open('heyta-vault');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    }) : undefined;
    let records: unknown[] = [];
    if (db !== undefined && db.objectStoreNames.contains('meta')) {
      records = await new Promise<unknown[]>((resolve) => {
        const request = db.transaction('meta', 'readonly').objectStore('meta').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      db.close();
    }
    return JSON.stringify({ local, records });
  });
}

test('vault settings: create, confirm, lock, recovery unlock and change passphrase', async ({ page }) => {
  const browserErrors: string[] = [];
  const notFoundResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') { browserErrors.push(`[console.error] ${message.text()}`); console.error(message.text()); }
  });
  page.on('pageerror', (error) => { browserErrors.push(`[pageerror] ${error.message}`); console.error(error.message); });
  page.on('response', (response) => {
    if (response.status() === 404) notFoundResponses.push(`${response.request().method()} ${response.url()}`);
  });
  await mkdir(EVIDENCE, { recursive: true });
  await seedCredentials(page);
  const fixture = await installHttpFixture(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await page.goto('/?lang=en');
  await expect(page.locator('input[placeholder^="Add a task"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');

  await page.getByRole('button', { name: 'Sync settings' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await screenshot(page, '00-loaded-light.png');
  await expect(dialog.getByTestId('vault-create-form')).toBeVisible();
  await fillVaultSecret(dialog.getByTestId('vault-create-passphrase'), 'correct horse battery staple');
  await dialog.getByTestId('vault-create').click();
  await expect(dialog.getByTestId('vault-recovery-display')).toBeVisible();
  await screenshot(page, '01-created-light.png');
  expect(fixture.putCount(), 'unconfirmed recovery code must not publish a package').toBe(0);

  const recoveryCode = await dialog.getByTestId('vault-recovery-display').textContent();
  expect(/^[0-9A-Z-]{40,}$/u.test(recoveryCode ?? ''), 'recovery code format is valid').toBe(true);
  await fillVaultSecret(dialog.getByTestId('vault-recovery-confirm'), recoveryCode ?? '');
  await dialog.getByTestId('vault-publish').click();
  await expect(dialog.getByTestId('vault-ready')).toBeVisible();
  await screenshot(page, '02-ready-light.png');
  expect(fixture.putCount()).toBe(1);
  expect(fixture.published()).toBeDefined();

  const afterCreateStorage = await storageDump(page);
  expect(afterCreateStorage.includes(recoveryCode!.replaceAll('-', '')), 'recovery code is absent from storage').toBe(false);
  expect(afterCreateStorage.includes('recoveryCode'), 'recovery-code field is absent from storage').toBe(false);
  expect(afterCreateStorage.includes('"rootKey":'), 'root-key field is absent from storage').toBe(false);

  await page.reload();
  await expect(page.locator('input[placeholder^="Add a task"]')).toBeVisible();
  await page.getByRole('button', { name: 'Sync settings' }).click();
  const reloadedDialog = page.getByRole('dialog');
  await expect(reloadedDialog.getByTestId('vault-unlock-form')).toBeVisible();
  await screenshot(page, '03-locked-after-reload-light.png');

  await page.getByRole('button', { name: 'Close sync settings' }).click();
  // 🔴 主题开关自 2026-10-06（H9 第三刀）起住在**设置浮层**「显示」那一节，不再是页头常驻的一枚。
  // 走共享 `switchTheme`（开浮层 → 点真开关 → 钉 `data-theme` → 收浮层）而不是新写一条路径：
  // `emulateMedia` 那枚假绿在 `calendar-cells` / `habit-month-stats` 各记过一次。
  // ⚠️ 必须**收掉**浮层：它是整屏的，不关就盖住下面那张 `04-wrong-recovery-dark.png`。
  await switchTheme(page, 'dark');
  await page.getByRole('button', { name: 'Sync settings', exact: true }).click();
  await fillVaultSecret(reloadedDialog.getByTestId('vault-recovery-code'), '0000-0000-0000-0000-0000-0000-0000-0000-0000');
  await reloadedDialog.getByTestId('vault-unlock-recovery').click();
  await screenshot(page, '04-wrong-recovery-dark.png');
  await expect(reloadedDialog.getByTestId('vault-error')).toBeVisible();
  await expect(reloadedDialog.getByTestId('vault-unlocked')).toHaveCount(0);

  await fillVaultSecret(reloadedDialog.getByTestId('vault-recovery-code'), recoveryCode ?? '');
  await reloadedDialog.getByTestId('vault-unlock-recovery').click();
  await expect(reloadedDialog.getByTestId('vault-recovery-rotation')).toBeVisible();
  await reloadedDialog.getByTestId('vault-lock').click();
  await expect(reloadedDialog.getByTestId('vault-unlock-form')).toBeVisible();

  await fillVaultSecret(reloadedDialog.getByTestId('vault-recovery-code'), recoveryCode ?? '');
  await reloadedDialog.getByTestId('vault-unlock-recovery').click();
  await expect(reloadedDialog.getByTestId('vault-recovery-rotation')).toBeVisible();
  await fillVaultSecret(reloadedDialog.getByTestId('vault-new-passphrase'), 'a different passphrase');
  await reloadedDialog.getByTestId('vault-change-passphrase').click();
  await expect(reloadedDialog.getByTestId('vault-recovery-display')).toBeVisible();
  const nextRecoveryCode = await reloadedDialog.getByTestId('vault-recovery-display').textContent();
  await fillVaultSecret(reloadedDialog.getByTestId('vault-recovery-confirm'), nextRecoveryCode ?? '');
  await reloadedDialog.getByTestId('vault-publish').click();
  await expect(reloadedDialog.getByTestId('vault-ready')).toBeVisible();
  await screenshot(page, '05-ready-dark.png');
  expect(fixture.putCount()).toBe(2);
  expect((await storageDump(page)).includes(nextRecoveryCode!.replaceAll('-', '')),
    'rotated recovery code is absent from storage').toBe(false);
  expect(fixture.unexpected(), `unexpected fixture requests: ${fixture.unexpected().join(' | ')}`).toEqual([]);
  // A missing package is the expected pre-creation response. Chromium logs
  // that intentional 404 as a resource error, so keep it explicitly bounded
  // instead of weakening the console/pageerror capture for unrelated errors.
  expect(notFoundResponses, `404 responses: ${notFoundResponses.join(' | ')}`).toEqual([
    `GET ${SERVER}/api/sync/key-package`,
  ]);
  expect(browserErrors, `browser errors: ${browserErrors.join(' | ')}`).toEqual([
    '[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)',
    // 🔴 2026-10-06 起主题开关住在「设置 → 显示」浮层里，切暗色必须**打开设置**；
    // 而设置浮层挂载时会探一次 `/api/admin/overview`（上面那行 `page.route` 就是为它准备的，
    // 固定回 403 = "这个人不是运营者"）。Chromium 把任何 4xx 都记成一条 console error，
    // 所以这条是**多了一个已命名的来源**，不是放宽：第三枚没登记过的错误照样让这一条红。
    '[console.error] Failed to load resource: the server responded with a status of 403 (Forbidden)',
  ]);
});
