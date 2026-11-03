/**
 * 头像明文旅程（真浏览器 · 假服务端只搬明文载荷）
 * ============================================
 *
 * ADR-0079（2026-11-01，产品绝对决策）：昵称与头像是**基础资料**，明文读写，
 * 不需要 E2EE 口令 / vault 解锁。本用例替换旧的 `profile-avatar-e2ee.spec.ts`。
 *
 * ## 三段旅程与各自的产品结论
 *
 * | 段 | 断言的产品结论 |
 * |---|---|
 * | ① 冷启动、未输入任何口令 | 「换一张」可用；页面上**没有**解锁提示、没有「去解锁」 |
 * | ② 选一张真图 | 出站 body 就是 `{contentType,dataBase64}`；预览真的渲染出像素；成功句讲头像 |
 * | ③ 刷新一次 | **不需要解锁**，图仍然显示（服务端返回明文）；没有"这台设备解不开"那类句子 |
 *
 * ## 载体
 *
 * dev server + `page.route`：假服务端只会把 `{contentType,dataBase64}` 存下来再吐回去。
 * 本用例不验加密（那是被推翻的旧前提），只验"基础资料不该被密码学挡住"。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import {
  decidePrivacyConsent,
  enableAllModules,
  openSettingsView,
  selectSettingsSection,
  stubLegalRecheck,
  stubPublicFacts,
  waitForOverlaySettled,
} from './helpers';
import { installMissingProducerShims } from './shims';

/** 假服务端：一个**不会被解析**的地址，所有请求都被 `page.route` 截住。 */
const SERVER = 'http://sync.e2e.test';
const REALTIME_WS = 'ws://sync.e2e.test/**';

const PANEL = '[data-testid="profile-panel"]';
const AVATAR_IMG = '[data-testid="profile-avatar-img"]';
const FILE_INPUT = '[data-testid="profile-avatar-file"]';
const WRITE_NOTICE = '[data-testid="profile-avatar-notice"]';

const SHOT = (name: string): string => `../apps/web/evidence/profile-panel/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/** 词条表是唯一文案事实源：期望串从这里读，不抄进测试。 */
async function zhValue(key: string): Promise<string> {
  const src = await readFile(
    new URL('../../packages/i18n/src/locales/zh-CN.ts', import.meta.url),
    'utf8',
  );
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp(`^  '${escaped}': '(.*)',?$`, 'mu').exec(src);
  if (line === null) throw new Error(`在 packages/i18n/src/locales/zh-CN.ts 里读不到键「${key}」`);
  return line[1].replace(/\\'/gu, "'").replace(/\\\\/gu, '\\');
}

type AvatarStore = {
  contentType: string | null;
  dataBase64: string | null;
  hash: string | null;
};

async function fakeServer(page: Page, store: AvatarStore): Promise<string[]> {
  const unexpected: string[] = [];

  // ⚠️ catch-all 必须**最先**注册：Playwright 是后注册的先匹配。
  await page.route(`${SERVER}/**`, (route) => {
    const url = new URL(route.request().url());
    unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route(`${SERVER}/api/announcements/active`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ announcements: [] }) }));
  await page.route(`${SERVER}/api/auth/central/config`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  /*
   * 🔴 `GET /api/sync/payload-mode` 是 ADR-0080 之后**应用一启动就会发**的读（载荷模式）。
   * 这个夹具的规矩是"没登记的请求算意外"，所以新端点必须在这里登记 ——
   * 与本文件里 `/api/announcements/active` 那几条同一条纪律。
   * 回 `readable`（明文账号）而不是 `e2ee`：`e2ee` 会让 vault 面板去探 key-package，
   * 而本用例的主题不是加密，不该把那一路请求带进来。
   */
  await page.route(`${SERVER}/api/sync/payload-mode`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'readable' }) }));

  await page.route(`${SERVER}/api/account/profile**`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ displayName: '小鹿', avatarHash: store.hash }),
      });
      return;
    }
    const body = (route.request().postDataJSON() ?? {}) as { displayName?: string | null };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ displayName: body.displayName ?? null, avatarHash: store.hash }),
    });
  });

  await page.route(`${SERVER}/api/account/avatar**`, async (route) => {
    const method = route.request().method();
    if (method === 'PUT') {
      const body = (route.request().postDataJSON() ?? {}) as {
        contentType?: string;
        dataBase64?: string;
      };
      if (typeof body.contentType !== 'string' || typeof body.dataBase64 !== 'string') {
        await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
        return;
      }
      store.contentType = body.contentType;
      store.dataBase64 = body.dataBase64;
      store.hash = 'sha256-e2e-avatar';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avatarHash: store.hash }),
      });
      return;
    }
    if (method === 'DELETE') {
      store.contentType = null;
      store.dataBase64 = null;
      store.hash = null;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ avatarHash: null }),
      });
      return;
    }
    if (store.dataBase64 === null || store.contentType === null) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        contentType: store.contentType,
        dataBase64: store.dataBase64,
        avatarHash: store.hash,
      }),
    });
  });

  await stubLegalRecheck(page, SERVER);
  await stubPublicFacts(page, SERVER);
  await page.route(`${SERVER}/api/admin/overview`, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Forbidden' }) }));
  await page.routeWebSocket(REALTIME_WS, () => undefined);
  await page.route(`${SERVER}/api/sync/status**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ latestSeq: 0 }) }));
  await page.route(`${SERVER}/api/notifications**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ notifications: [], unreadCount: 0 }) }));
  await page.route(`${SERVER}/api/activity**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaigns: [] }) }));
  await page.route(`${SERVER}/api/passkeys**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passkeys: [] }) }));
  await page.route(`${SERVER}/api/automation/rules`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rules: [] }) }));
  await page.route(`${SERVER}/api/automation/events`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ events: [] }) }));
  await page.route(`${SERVER}/api/account/email/change/status`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ pending: false, awaitingOld: false, awaitingNew: false }),
    }));
  await page.route(`${SERVER}/api/sync/ops**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], latestSeq: 0 }) }));
  /*
   * 🔴 `GET /api/auth/sessions` 是「账号」那一组里**已登录设备列表**（`SessionsPanel`）
   * 一挂载就会发的读（服务端契约 `server/src/account/account-security.routes.ts`
   * `fastify.get('/auth/sessions')` → `{ sessions: [...] }`）。这个夹具的规矩是
   * "没登记的请求算意外"，所以新端点必须在这里登记 ——
   * 与上面 `/api/sync/payload-mode` 那条**同一条纪律**。
   * 那一趟的失败原文：`假服务端收到了没登记过的调用：GET /api/auth/sessions |
   * GET /api/auth/sessions`（两次：进设置一次 + 刷新后一次）。
   *
   * ⚠️ 回**空列表**而不是 404：`sessionsStore` 把读侧失败画成一条失败提示（它刻意
   * 不画成空列表），而这一条用例的主题是"基础资料明文"，不该让一条与头像无关的
   * 失败横幅混进截图与断言。空列表 = "这台设备是唯一登录着的那一台"，是这一趟的
   * 合成账号本来的事实。
   */
  await page.route(`${SERVER}/api/auth/sessions**`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessions: [] }) }));

  return unexpected;
}

test('🔴 头像：不输入任何口令就能换、刷新后仍在（基础资料明文）', async ({ page }) => {
  const errors = watchConsole(page);
  const store: AvatarStore = { contentType: null, dataBase64: null, hash: null };

  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-avatar-token', email: 'deer@example.test' }),
    );
  }, SERVER);
  const unexpected = await fakeServer(page, store);

  await page.setViewportSize({ width: 1280, height: 900 });
  await enableAllModules(page);
  await installMissingProducerShims(page);
  await page.goto('/?lang=zh-CN');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');

  // ── ① 冷启动：没有口令、也没有任何解锁提示 ──────────────────────
  await openSettingsView(page);
  await selectSettingsSection(page, 'profile');
  await expect(page.locator(PANEL)).toBeVisible();
  await waitForOverlaySettled(page, 'settings-sheet');
  await expect(page.locator('[data-testid="profile-avatar-need-password"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="profile-avatar-unlock"]')).toHaveCount(0);
  await expect(page.getByTestId('profile-avatar-change')).toBeEnabled();
  await expect(page.locator(AVATAR_IMG)).toHaveCount(0);
  await page.screenshot({ path: SHOT('avatar-plain-1-profile'), fullPage: false });

  // ── ② 选一张真图：出站就是明文载荷，预览真的渲染出像素 ─────────
  const sourceShot = 'test-results/avatar-source.png';
  await page.screenshot({ path: sourceShot, clip: { x: 200, y: 200, width: 240, height: 240 } });
  await page.locator(FILE_INPUT).setInputFiles(sourceShot);

  await expect(page.locator(WRITE_NOTICE)).toHaveText(await zhValue('common.profile.avatar.uploaded'));
  expect(store.dataBase64, '上传之后服务端没有收到任何图片字节').not.toBeNull();
  expect(store.contentType, '服务端拿不到 contentType ⇒ 契约里那两个键没发出去').toMatch(/^image\//u);
  expect(
    Buffer.from(store.dataBase64 ?? '', 'base64').length,
    '服务端收到的是 0 字节',
  ).toBeGreaterThan(0);

  await expect(page.locator(AVATAR_IMG)).toBeVisible();
  const rendered = await page.locator(AVATAR_IMG).evaluate((el) => {
    const img = el as HTMLImageElement;
    return { natural: img.naturalWidth, srcHead: img.src.slice(0, 11) };
  });
  expect(rendered.natural, '显示了 `<img>` 却没有画出任何像素（naturalWidth = 0）').toBeGreaterThan(0);
  expect(rendered.srcHead).toMatch(/^data:image\//u);
  await waitForOverlaySettled(page, 'settings-sheet');
  await page.screenshot({ path: SHOT('avatar-plain-2-ready'), fullPage: false });

  // 暗色：实际切属性，并等浮层落位后拍。
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await expect(page.locator(AVATAR_IMG)).toBeVisible();
  await waitForOverlaySettled(page, 'settings-sheet');
  await page.screenshot({ path: SHOT('avatar-plain-3-ready-dark'), fullPage: false });
  await page.evaluate(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  // ── ③ 刷新：**不需要解锁**，图仍然显示 ─────────────────────────
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await openSettingsView(page);
  await selectSettingsSection(page, 'profile');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('[data-testid="profile-avatar-need-password"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="profile-avatar-unlock"]')).toHaveCount(0);
  await expect(page.locator(AVATAR_IMG)).toBeVisible();
  const afterReload = await page.locator(AVATAR_IMG).evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(afterReload, '刷新后图没有画出来 —— 明文读写不该依赖任何会话钥匙').toBeGreaterThan(0);
  expect(store.dataBase64, '刷新之后服务端的头像不见了 ⇒ 这一腿测的不是同一个状态').not.toBeNull();
  await waitForOverlaySettled(page, 'settings-sheet');
  await page.screenshot({ path: SHOT('avatar-plain-4-after-reload'), fullPage: false });

  const KNOWN_UNSTUBBED = ['/api/auth/central/config'] as const;
  const unexpectedBeyondKnown = unexpected.filter(
    (call) => !KNOWN_UNSTUBBED.some((known) => call.endsWith(known)),
  );
  expect(unexpectedBeyondKnown, `假服务端收到了没登记过的调用：${unexpectedBeyondKnown.join(' | ')}`).toEqual([]);
  const profileErrors = errors.filter((e) => /account|avatar|profile/iu.test(e));
  expect(profileErrors, `资料链上的控制台报错：${profileErrors.join(' | ')}`).toEqual([]);
});
