import { expect, test, type Page } from '@playwright/test';

import {
  decidePrivacyConsent,
  enableAllModules,
  pinChineseUi,
  stubLegalRecheck,
  stubPublicFacts,
  waitForBootSplashGone,
} from './helpers';
import { installMissingProducerShims } from './shims';
import { STUB_ORIGIN, STUB_PORT } from '../ports';

/**
 * 用户侧那一横条公告在**真界面**里（§6.2 规定一：判据是图）。
 * ==========================================================
 *
 * jsdom 那一份（`apps/web/tests/announcement-banner.spec.tsx`）钉的是组件行为；
 * 这一份只钉**只有真浏览器才证得到的那一件事**：
 *
 *   🔴 它挂在应用本体的主区顶上，而**不是**某一层浮层里。
 *
 * 组件自己测一百遍也测不出"App 忘了挂它"—— 而"忘了挂"恰恰是这一族里
 * 唯一会让整条功能链归零的错法（服务端有数据、后台能发、用户永远看不见）。
 *
 * 与同族那几条一样的纪律：假的只有服务端的响应体，被测对象是真的
 * （真 Chromium、真 fetch、真 localStorage、真路由）。
 *
 * ## 证据落点
 *
 * 图落在受版本控制的 `apps/web/evidence/admin-console/`（与后台那条同一目录：
 * 公告的写面与读面是同一件事的两端，看的人要能在一个地方翻到）。
 */

const SERVER = STUB_ORIGIN;
const ACTIVE_PATH = '/api/announcements/active';
const REALTIME_WS_GLOB = `ws://127.0.0.1:${String(STUB_PORT)}/api/sync/ws*`;
const EVIDENCE = '../apps/web/evidence/admin-console';

const DAY_MS = 86_400_000;
const NOW = Date.now();

/**
 * 两条"挂着"的公告。
 *
 * 🔴 第二条的 `expiresAt` 在**过去**：它照样出现在这份响应里，因为"有效"是
 * 服务端那一查询判的。界面若在本地再滤一次，这一条就不会画出来 ——
 * 而这一句断言（"两条都在响应里，界面只画最新那条，且**不是因为滤掉了过期**"）
 * 就分不清是哪一个原因了。所以这里给的是"时间上早就过期、服务端说还挂着"，
 * 关掉第一条之后它必须顶上来。
 */
const ACTIVE_BODY = {
  announcements: [
    {
      id: 7,
      title: '今晚维护',
      body: '同步暂停约 20 分钟，期间离线仍然可以照常记录。',
      level: 'warning',
      publishedAt: NOW,
      expiresAt: null,
    },
    {
      id: 6,
      title: '新账号要邀请码',
      body: '注册入口暂时只向邀请码开放。',
      level: 'info',
      publishedAt: NOW - 3 * DAY_MS,
      expiresAt: NOW - DAY_MS,
    },
  ],
};

interface PageProblems {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly badResponses: string[];
}

/** 🔴 AGENTS §6.2 规定一第 3 条：监听必须在页面创建时就挂上。 */
function captureProblems(page: Page): PageProblems {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push(new URL(res.url()).pathname);
  });
  return { consoleErrors, pageErrors, badResponses };
}

/** 本仓库从来没有 favicon（同 `inbox.spec.ts` 与 `admin-console.spec.ts` 的登记）。 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

function assertNoProblems(problems: PageProblems, expectedBad: readonly string[] = []): void {
  const unexpected = problems.badResponses.filter(
    (path) => !KNOWN_MISSING.some((known) => path === known) && !expectedBad.includes(path),
  );
  expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);
  const nonResource = problems.consoleErrors.filter((text) => !/Failed to load resource/u.test(text));
  expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  expect(problems.pageErrors, `不该有未捕获异常：${JSON.stringify(problems.pageErrors)}`).toEqual([]);
}

/**
 * @param status `/api/announcements/active` 回什么。500 那一档用来验"拉不到就什么都不画"。
 */
async function openAppWithAnnouncements(page: Page, status = 200): Promise<void> {
  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-announce-token', email: 'me@example.test' }),
    );
  }, SERVER);

  await enableAllModules(page);
  await pinChineseUi(page);
  await stubLegalRecheck(page, SERVER);
  await stubPublicFacts(page, SERVER);

  await page.routeWebSocket(REALTIME_WS_GLOB, () => {
    // 保持打开即可，本支不验实时同步。
  });
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ latestSeq: 0 }) });
  });
  // 与 `ai-panel-layout.spec.ts` 逐字同一处置：这一发外部登录配置带
  // `credentials: 'include'`，而夹具给的是通配 `Access-Control-Allow-Origin`，
  // 在本机必被 CORS 拦 —— 它与公告无关，不补位就会把"控制台不该有 JS 报错"
  // 那条断言污染成环境噪音（那条用例的注释原话：环境噪音）。
  await page.route('**/api/auth/central/config', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${SERVER}/api/notifications**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ notifications: [], unreadCount: 0 }),
    });
  });
  await page.route(`${SERVER}${ACTIVE_PATH}**`, async (route) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? ACTIVE_BODY : { error: 'boom' }),
    });
  });

  await installMissingProducerShims(page);
  await page.goto('/');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');
  await waitForBootSplashGone(page);
}

test.describe('那一横条公告在应用里（真浏览器）', () => {
  test('🔴 挂在主区顶上，而任务视图照常能用；一次只画最新那条', async ({ page }) => {
    // 监听在导航之前就挂上（规定一第 3 条），否则加载期的错收不到。
    const problems = captureProblems(page);
    await openAppWithAnnouncements(page);

    const banner = page.getByTestId('announcement-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('今晚维护');
    await expect(banner).toContainText('同步暂停约 20 分钟');
    // 🔴 第二条不许同时出现（三条一起挂会把这个告知变成故障现场）。
    await expect(banner).not.toContainText('新账号要邀请码');
    await expect(page.getByTestId('announcement-banner')).toHaveCount(1);
    // warning 档带有它自己的形状 —— 形状挂在这一横条**自己身上**，不是里面还有一层。
    await expect(banner).toHaveClass(/ht-main__announcement--warning/u);

    // 🔴 这一行才是本支存在的理由：公告是**加在应用本体上**的，不是换掉它。
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await expect(page.locator('.ht-rail')).toBeVisible();

    // 它在主区里，不在任何浮层（dialog）里。
    await expect(page.locator('main .ht-main__announcement')).toHaveCount(1);
    await expect(page.locator('[role="dialog"] .ht-main__announcement')).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE}/announcement-banner-light.png`, fullPage: true });
    assertNoProblems(problems);
  });

  test('关掉一条 ⇒ 下一条顶上来，且忽略只落本机', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === ACTIVE_PATH) reads.push(request.url());
    });

    await openAppWithAnnouncements(page);
    await expect(page.getByTestId('announcement-banner')).toBeVisible();

    await page.getByRole('button', { name: '知道了', exact: true }).click();

    const banner = page.getByTestId('announcement-banner');
    await expect(banner).toContainText('新账号要邀请码');
    await expect(banner).not.toContainText('今晚维护');

    // 🔴 关一条之后**没有再发请求**：忽略是本机的事，服务端没有阅读史（ADR-0075 §3.5）。
    expect(reads).toHaveLength(1);

    const stored = await page.evaluate(() =>
      localStorage.getItem('heyta.announcements.dismissed'),
    );
    expect(JSON.parse(stored ?? '[]')).toEqual([7]);

    await page.screenshot({ path: `${EVIDENCE}/announcement-banner-next.png`, fullPage: true });
  });

  test('🔴 服务端 500 ⇒ 什么都不画（不许把告知条变成故障现场）', async ({ page }) => {
    await openAppWithAnnouncements(page, 500);

    await expect(page.getByTestId('announcement-banner')).toHaveCount(0);
    // 这一屏上不许出现任何一句"公告出错了"的话。
    await expect(page.locator('.ht-main__announcement')).toHaveCount(0);
    // 而应用本体照常。
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE}/announcement-banner-error.png`, fullPage: true });
  });
});
