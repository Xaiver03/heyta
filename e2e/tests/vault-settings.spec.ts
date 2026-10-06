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
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  closeSettingsSheet,
  decidePrivacyConsent,
  enableAllModules,
  openSettingsSheet,
  stubLegalRecheck,
  stubPublicFacts,
  switchTheme,
} from './helpers';
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

/**
 * 打开 **设置 → 同步** 那一节，返回它的定位符。
 *
 * 🔴 H9 第 3 刀（2026-10-06）之前这里是 `点齿轮 → getByRole('dialog')`。
 * 同步设置现在是设置浮层里的**一节**，而那一层是可滚动的长列表 ——
 * 所以必须 `scrollIntoViewIfNeeded()`：不滚的话下面那三张证据图拍的是
 * 设置浮层的**顶部**，而用例声称在量的是密钥表单（§6.2 规定一"人必须看图"
 * 的前提是图里真的是那件事）。
 */
async function openSyncSection(page: Page): Promise<Locator> {
  // ⚠️ 用 `openSettingsSheet` 而不是 `openSettingsView`：后者顺手钉一句
  // 「页头标题真的是『设置』」，而**这一份套件跑的是英文界面**（`/?lang=en`，见上面）——
  // 用它就会红在夹具的中文前提上（2026-10-06 实测：Received "Settings"）。
  await openSettingsSheet(page);
  const section = page.getByTestId('sync-settings-panel');
  await expect(section, '设置浮层里没有「同步」那一节').toBeVisible();
  await section.scrollIntoViewIfNeeded();
  return section;
}

test('vault settings: create, confirm, lock, recovery unlock and change passphrase', async ({ page }) => {
  const browserErrors: string[] = [];
  const notFoundResponses: string[] = [];
  // 🔴 设置浮层每挂载一次，`AdminPanel` 就探一次 `/api/admin/overview`，
  // 而那份桩固定回 403（"这个人不是运营者"）⇒ Chromium 记一条 console error。
  // H9 第 3 刀之后 同步设置住在设置里，本用例会**多次**进出那一层，
  // 所以白名单不能再写死条数 —— 改成**由真实可观察量推导**：
  // 探了几次，就该有几条 403；多一条没登记过的错误照样红。
  const adminProbes: number[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') { browserErrors.push(`[console.error] ${message.text()}`); console.error(message.text()); }
  });
  page.on('pageerror', (error) => { browserErrors.push(`[pageerror] ${error.message}`); console.error(error.message); });
  page.on('response', (response) => {
    if (response.status() === 404) notFoundResponses.push(`${response.request().method()} ${response.url()}`);
    if (response.status() === 403 && response.url().includes('/api/admin/overview')) adminProbes.push(response.status());
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

  const syncSection = await openSyncSection(page);
  await screenshot(page, '00-loaded-light.png');
  await expect(syncSection.getByTestId('vault-create-form')).toBeVisible();
  await fillVaultSecret(syncSection.getByTestId('vault-create-passphrase'), 'correct horse battery staple');
  await syncSection.getByTestId('vault-create').click();
  await expect(syncSection.getByTestId('vault-recovery-display')).toBeVisible();
  await screenshot(page, '01-created-light.png');
  expect(fixture.putCount(), 'unconfirmed recovery code must not publish a package').toBe(0);

  const recoveryCode = await syncSection.getByTestId('vault-recovery-display').textContent();
  expect(/^[0-9A-Z-]{40,}$/u.test(recoveryCode ?? ''), 'recovery code format is valid').toBe(true);
  await fillVaultSecret(syncSection.getByTestId('vault-recovery-confirm'), recoveryCode ?? '');
  await syncSection.getByTestId('vault-publish').click();
  await expect(syncSection.getByTestId('vault-ready')).toBeVisible();
  await screenshot(page, '02-ready-light.png');
  expect(fixture.putCount()).toBe(1);
  expect(fixture.published()).toBeDefined();

  const afterCreateStorage = await storageDump(page);
  expect(afterCreateStorage.includes(recoveryCode!.replaceAll('-', '')), 'recovery code is absent from storage').toBe(false);
  expect(afterCreateStorage.includes('recoveryCode'), 'recovery-code field is absent from storage').toBe(false);
  expect(afterCreateStorage.includes('"rootKey":'), 'root-key field is absent from storage').toBe(false);

  await page.reload();
  await expect(page.locator('input[placeholder^="Add a task"]')).toBeVisible();
  const sectionAfterReload = await openSyncSection(page);
  await expect(sectionAfterReload.getByTestId('vault-unlock-form')).toBeVisible();
  await screenshot(page, '03-locked-after-reload-light.png');

  await closeSettingsSheet(page);
  // 🔴 主题开关自 2026-10-06（H9 第三刀）起住在**设置浮层**「显示」那一节，不再是页头常驻的一枚。
  // 走共享 `switchTheme`（开浮层 → 点真开关 → 钉 `data-theme` → 收浮层）而不是新写一条路径：
  // `emulateMedia` 那枚假绿在 `calendar-cells` / `habit-month-stats` 各记过一次。
  // ⚠️ 必须**收掉**浮层：它是整屏的，不关就盖住下面那张 `04-wrong-recovery-dark.png`。
  await switchTheme(page, 'dark');
  await openSyncSection(page);
  await fillVaultSecret(sectionAfterReload.getByTestId('vault-recovery-code'), '0000-0000-0000-0000-0000-0000-0000-0000-0000');
  await sectionAfterReload.getByTestId('vault-unlock-recovery').click();
  await screenshot(page, '04-wrong-recovery-dark.png');
  await expect(sectionAfterReload.getByTestId('vault-error')).toBeVisible();
  await expect(sectionAfterReload.getByTestId('vault-unlocked')).toHaveCount(0);

  await fillVaultSecret(sectionAfterReload.getByTestId('vault-recovery-code'), recoveryCode ?? '');
  await sectionAfterReload.getByTestId('vault-unlock-recovery').click();
  await expect(sectionAfterReload.getByTestId('vault-recovery-rotation')).toBeVisible();
  await sectionAfterReload.getByTestId('vault-lock').click();
  await expect(sectionAfterReload.getByTestId('vault-unlock-form')).toBeVisible();

  await fillVaultSecret(sectionAfterReload.getByTestId('vault-recovery-code'), recoveryCode ?? '');
  await sectionAfterReload.getByTestId('vault-unlock-recovery').click();
  await expect(sectionAfterReload.getByTestId('vault-recovery-rotation')).toBeVisible();
  await fillVaultSecret(sectionAfterReload.getByTestId('vault-new-passphrase'), 'a different passphrase');
  await sectionAfterReload.getByTestId('vault-change-passphrase').click();
  await expect(sectionAfterReload.getByTestId('vault-recovery-display')).toBeVisible();
  const nextRecoveryCode = await sectionAfterReload.getByTestId('vault-recovery-display').textContent();
  await fillVaultSecret(sectionAfterReload.getByTestId('vault-recovery-confirm'), nextRecoveryCode ?? '');
  await sectionAfterReload.getByTestId('vault-publish').click();
  await expect(sectionAfterReload.getByTestId('vault-ready')).toBeVisible();
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
  /*
    🔴 浏览器错误白名单：**条数由真实可观察量推导，不写死**。
    来源只有两枚，都登记过：
      · `key-package` 那次 404（建库之前的预期应答，上面 `notFoundResponses` 已逐条钉死）；
      · 设置浮层每次挂载时 `AdminPanel` 探一次 `/api/admin/overview`，那份桩固定回 403
        ⇒ Chromium 记一条 console error。H9 第 3 刀之后 同步设置住在设置里，本用例
        进出那一层**不止一次**（2026-10-06 之前是 2 次：主题切换那一次；现在是 5 次），
        所以再写死一个数就是下一批的假红 —— 改成"探了几次就该有几条"。
    仍然有牙：任何**第三种**错误文本照样让第一条断言红，
    而"403 少了一条"（说明某次挂载没探 admin，即设置浮层没真的挂载）由第二条红。
  */
  const ADMIN_403 = '[console.error] Failed to load resource: the server responded with a status of 403 (Forbidden)';
  const PACKAGE_404 = '[console.error] Failed to load resource: the server responded with a status of 404 (Not Found)';
  const unregistered = browserErrors.filter((line) => line !== ADMIN_403 && line !== PACKAGE_404);
  expect(unregistered, `未登记的浏览器错误: ${unregistered.join(' | ')}`).toEqual([]);
  expect(
    browserErrors.filter((line) => line === PACKAGE_404).length,
    `404 文本的条数应与上面那条 404 响应一一对应（实际 ${String(browserErrors.filter((l) => l === PACKAGE_404).length)}）`,
  ).toBe(notFoundResponses.length);
  expect(
    browserErrors.filter((line) => line === ADMIN_403).length,
    `403 的条数应等于 admin overview 被探的次数（探了 ${String(adminProbes.length)} 次）`,
  ).toBe(adminProbes.length);
  expect(adminProbes.length, '设置浮层一次都没挂载 ⇒ 这个用例根本没走到同步那一节').toBeGreaterThan(0);
});
