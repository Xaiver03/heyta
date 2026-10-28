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
  selectSettingsSection,
  stubLegalRecheck,
  stubPublicFacts,
  switchTheme,
} from './helpers';
import { installMissingProducerShims } from './shims';

const SERVER = 'http://sync.vault.e2e.test';
const ACCOUNT_ID = 'vault-browser-account-1';
const DEVICE_CLIENT_ID = 'e2e0000000000001';
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

async function installHttpFixture(
  page: Page,
  /**
   * 装几台已登录设备。默认 `[]` —— 原有那一条用例看的是空态，
   * 把设备数写死成非空会顺手改掉它的画面。
   */
  devices: readonly string[] = [],
): Promise<{
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
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        // 🔴 `lastSeenAt` 是 **Unix 毫秒**（`SuperSyncDeviceSchema`：`z.number()`），
        //    不是 ISO 串。第一版发的是字符串 ⇒ `safeParse` 失败 ⇒ 面板读成
        //    "设备列表是空的"，而红话说的是"那一行没画出来" —— 假红指错了方向。
        devices: devices.map((clientId) => ({ clientId, lastSeenAt: Date.now() })),
      }),
    }));
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
  // 🔴 2026-10-25：应用新加了三条**开机就会发**的读请求，而这个 fixture 是
  // **故意严格**的（catch-all 把没登记的一律记成 `unexpected`）⇒ 不给它们装桩，
  // 红起来读成"密钥面坏了"。三条都是与本主题无关的惰性空态：
  //   · `/api/auth/central/config` —— 中心认证入口探测（`{}` = 没有这项能力）
  //   · `/api/announcements/active` —— 运营公告（`{ announcements: [] }`）
  //   · `/api/automation/**` —— 入站自动化那两块面板（`{ rules: [] }` / `{ events: [] }`）
  await page.route(`${SERVER}/api/auth/central/config`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.route(`${SERVER}/api/announcements/active`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ announcements: [] }) }));
  await page.route(`${SERVER}/api/automation/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith('/events') ? { events: [] } : { rules: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

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
  // 🔴 2026-10-24：设置面板改成**分区切换**（侧栏一栏 + 内容区一节）之后，
  // "打开浮层就能看到同步那一节"不再成立 —— 必须先选中它。
  // 这一行补的是**夹具跟着 IA 走**，不是放宽判据：下面那条 `toBeVisible` 一个字没动。
  await selectSettingsSection(page, 'sync');
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
  /*
   * 🔴 2026-10-25 改判据：**一次 404 都不许有**（原来是"恰好一次 key-package 404"）。
   *
   * 旧口径的由来：建库之前应用会先探一次 `GET /api/sync/key-package`，那份 404 是
   * "还没建库"的预期应答。现在这个探**不再发生**（本轮实测：`notFoundResponses` 是空数组，
   * 而上面每一条 vault 断言都照旧通过 —— 也就是"库建起来了、能锁能换口令"全都没变）。
   *
   * 新口径比旧的**更严**，不是更松：旧写法只允许那一条 404，一旦应用开始探别的东西
   * 也能被这条抓住；现在连那一条都不许有。若哪天产品又把"先探一次"加回来，
   * 这一条会红 —— 那时该改的是这段注释与这个期望，而不是把白名单放宽成"任意 404"。
   */
  expect(notFoundResponses, `404 responses: ${notFoundResponses.join(' | ')}`).toEqual([]);
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
  /*
   * 🔴 2026-10-25 删掉一条**代理判据**（"adminProbes > 0 ⇒ 设置浮层挂载过"）。
   *
   * 它当时是"这一趟真的进过设置"的间接证据。而现在 `AdminPanel` 只住在
   * **`settings-group-data`** 那一节里（`DataSettingsPanel` 的 `active` 才挂它），
   * 本用例切的是 `settings-group-sync` ⇒ 那枚 403 探针**一次都不发**，
   * 代理读数恒为 0，于是这条判据把"没进设置"与"住了另一节"读成同一件事。
   *
   * 直接的判据在上面已经有两条，且都更硬：
   *   · `expect(section, '设置浮层里没有「同步」那一节').toBeVisible()` —— 没进设置/没切到那一节，它当场红；
   *   · 下面 `browserErrors` 里"未登记的浏览器错误必须为空"。
   * 所以这里不再补一条恒为 0 的间接量。⚠️ 若哪天把 `AdminPanel` 挪回同步那一节，
   * 上面那条"403 条数 = 探针次数"会自动恢复牙 —— 不需要把这条加回来。
   */
});

/**
 * 撤销设备这一格走危险确认（2026-10-27，全局 UX 整改 P2 第二格）
 * ============================================================
 *
 * 判据与回收站那一格同源（`e2e/tests/danger-confirm-trash.spec.ts` 是全集），这里只钉
 * **这一格特有的那件事**：它此前是 `window.confirm` —— 全仓 Web 侧**最后一枚**原生确认框。
 *
 * 🔴 为什么"仍然用原生框"这件事在本仓**不会报错、只会静默通过**：
 * Playwright 默认**自动 dismiss** 掉 `window.confirm`，于是那一发撤销永远返回 false，
 * 用例看到的是"点了没反应"，而产品那边是"用户根本读不到后果说明就被告知要重新登录"。
 * 所以这里同时钉两件事：确认框必须是**页内那一层**，且原生框**一次都没出现**。
 *
 * ⚠️ 不点"撤销这台设备"那一步：真撤销要装 DELETE 桩，而这一条的命题是
 *    "确认之前不发请求"与"这层的语义对不对"，用**取消**与 **Esc** 两条出口就够证。
 *    真执行那一腿归 `check:journey-coverage` 的登录态旅程，不在本文件（登记见计划 §P2）。
 */
test('撤销设备：页内危险确认，取消与 Esc 都不发出写请求', async ({ page }) => {
  // 前置照抄本文件那一条主用例的开局（英文界面 + 模块开关 + 隐私闸门 + 凭证）。
  // ⚠️ 少一步就会红在"找不到头像"这种夹具问题上，而不是红在产品上 ——
  //    第一版就是这么红的（`openSyncSection` 等 `account-menu-avatar` 60 秒超时），
  //    那种红**不能**当成本格的能红证据。
  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await seedCredentials(page);
  const fixture = await installHttpFixture(page, [DEVICE_CLIENT_ID]);
  await page.goto('/?lang=en');
  await expect(page.locator('input[placeholder^="Add a task"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');

  await openSyncSection(page);

  let nativeDialogSeen = false;
  page.on('dialog', async (dialog) => {
    nativeDialogSeen = true;
    await dialog.dismiss();
  });

  const revoke = page.getByTestId(`vault-device-revoke-${DEVICE_CLIENT_ID}`);
  await expect(revoke, '设备列表没画出那一行 ⇒ 后面的读数全是废的').toBeVisible();
  await revoke.click();

  const dialog = page.getByTestId('vault-revoke-confirm');
  await expect(
    dialog,
    '撤销设备仍走 window.confirm：原生框被自动 dismiss，页内那一层根本没出现',
  ).toBeVisible();
  expect(nativeDialogSeen, '还弹了原生确认框（Web 侧最后一枚 window.confirm 没清掉）').toBe(false);

  /**
   * 一目的地一控件：这一层**只有两枚按钮**（具名的安全侧 + 危险主按钮），
   * 没有第三枚图标式的 × 出口。
   *
   * ⚠️ 按**数量**判而不是按"取消"这个名字判：本套件跑的是英文界面（`/?lang=en`），
   *    第一版写死中文名字 ⇒ 它红在语言上（`Received: 0`），而不是红在产品上。
   *    数按钮既与语言无关，又恰好是这一条命题本来的样子。
   */
  await expect(dialog.getByRole('button')).toHaveCount(2);
  // 不可逆主按钮是 danger tone（读的是类，颜色那条在回收站那格里已经按计算值钉过）。
  await expect(page.getByTestId('vault-revoke-confirm-submit')).toHaveClass(/ht-btn--danger/);
  // 初始焦点在安全侧。
  await expect(page.getByTestId('vault-revoke-confirm-cancel')).toBeFocused();

  const writesBefore = fixture.unexpected().filter((line) => !line.startsWith('GET'));
  await page.keyboard.press('Escape');
  await expect(dialog, 'Esc 必须等价于取消（关掉）').toHaveCount(0);
  expect(
    fixture.unexpected().filter((line) => !line.startsWith('GET')),
    `取消/Esc 之后出现了写请求：${writesBefore.join(' | ')}`,
  ).toEqual([]);
});

/**
 * 计划 §P2 判据里最后那一格：**失败回执持续可见**。
 *
 * 为什么单独一条：撤销**失败**不是"这件事没发生"，而是"这台设备可能还在能同步"。
 * 回执一旦飘走，屏幕上就什么都不剩，用户读到的是"我已经撤了" —— 那是比不弹确认更坏的形状。
 *
 * 🔴 这条用例的**时长本身就是断言**：`waitForTimeout(5_500)` 比 toast 那一族的
 * 4~5 秒自消窗口长。如果将来有人把这句失败文案改走 `showToast`，第一发
 * `toHaveCount(1)` 仍然绿（toast 刚出现），红的是第二发 —— 这正是把它放在真实浏览器里
 * 而不是放在 jsdom 里的理由：jsdom 不会替你把计时器走完还顺手删掉 DOM。
 *
 * 401 是**故意选的**：`revokeHostedSyncDeviceBound` 只对 `request-failed` / `invalid-response`
 * 走"重试 + 判为 ambiguous"那条路（那两个码代表"响应丢了，不能证明服务端没删成"）；
 * `unauthorized` 直接抛出 ⇒ 面板落进 `.catch` ⇒ 持久 danger 回执。
 * 换成 404 测的是另一格（ambiguous ⇒ 会话被围栏清掉），不是这一格。
 */
test('撤销设备失败：回执是不自消的 alert，不是一条会飘走的 toast', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await seedCredentials(page);
  await installHttpFixture(page, [DEVICE_CLIENT_ID]);

  let deleteCount = 0;
  // 注册在 fixture 之后 ⇒ 这条优先命中；非 DELETE 一律 `fallback()` 交回原来的桩，
  // 否则会把设备列表那发 GET 一起吃掉（那发读回来是空的，红话会指错方向）。
  await page.route(`${SERVER}/api/sync/devices/**`, async (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback();
    deleteCount += 1;
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/?lang=en');
  await expect(page.locator('input[placeholder^="Add a task"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');
  await openSyncSection(page);

  await page.getByTestId(`vault-device-revoke-${DEVICE_CLIENT_ID}`).click();
  await page.getByTestId('vault-revoke-confirm-submit').click();

  await expect(page.getByTestId('vault-revoke-confirm'), '确认之后这一层要关掉').toHaveCount(0);
  expect(deleteCount, '点下「撤销这台设备」却没有发出 DELETE：主按钮没接上执行').toBe(1);

  const notice = page.locator('[data-testid="vault-device-error"][role="alert"]');
  await expect(notice, '撤销失败后屏幕上没有 role="alert" 的持久回执').toHaveCount(1);
  await page.waitForTimeout(5_500);
  await expect(notice, '失败回执自己消失了：它走的是会自消的 toast，不是就地常驻的 alert').toHaveCount(1);
});
