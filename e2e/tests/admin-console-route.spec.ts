import { expect, test, type Page } from '@playwright/test';

import {
  decidePrivacyConsent,
  pinChineseUi,
  stubLegalRecheck,
  stubPublicFacts,
  waitForBootSplashGone,
} from './helpers';
import { STUB_ORIGIN, STUB_PORT } from '../ports';

/**
 * `/admin` 这个地址在真浏览器里长什么样（§6.2 规定一：判据是**图**）。
 * ================================================================
 *
 * jsdom 那一份（`apps/web/tests/admin-console-route.spec.tsx`）钉的是判定与状态；
 * 这一份钉的是**只有真浏览器才有的那两件事**：
 *
 *   1. 敲 `/admin` 这个**地址**（不是点界面）真的能把树切到后台壳 ——
 *      这一条住在 `main.tsx` / `App.tsx` 的挂载处，jsdom 那套根本不经过入口；
 *   2. 切过去之后**应用本体没画出来**：任务输入框不在 DOM 里。
 *      壳与本体同时画是这一族里最容易漏的错法（症状是"后台下面还挂着一屏任务"，
 *      而所有单测都绿）。
 *
 * ## 🔴 与 `admin-console.spec.ts` 同一纪律：假的只有服务端的响应体
 *
 * 被测对象是真的：真 Chromium、真 `fetch`、真 store、真路由。
 * 只有"`/api/admin/*` 回什么"是造的 —— 那一套要 PostgreSQL。
 *
 * ## 证据落点
 *
 * 图落在受版本控制的 `apps/web/evidence/admin-console/`。
 * `e2e/test-results/` 每趟被清，只活在那里的"截图为证"下一趟就没人能再打开看。
 */

const SERVER = STUB_ORIGIN;
const ADMIN = `${SERVER}/api/admin`;
const EVIDENCE = '../apps/web/evidence/admin-console';
/** 与 `admin-console.spec.ts` 同一个上游：塞了凭据应用就会真连实时通道。 */
const REALTIME_WS_GLOB = `ws://127.0.0.1:${String(STUB_PORT)}/api/sync/ws*`;

const OVERVIEW = {
  users: { total: 8, verified: 6, admins: 1, locked: 2 },
  subscriptions: {
    total: 3,
    active: 2,
    entitledStatuses: ['active'],
    byStatus: [{ status: 'active', count: 2 }],
  },
  orders: {
    total: 5,
    byStatus: [{ status: 'paid', count: 5 }],
    paidByCurrency: [{ currency: 'CNY', paidOrders: 5, revenueMinor: 3_900 }],
  },
  coupons: { total: 2, enabled: 1, settledRedemptions: 7 },
  invites: { codes: 3, codesDisabled: 1, referrals: 2, referralsActivated: 2, referralsRewarded: 1 },
};

/**
 * 三天的营收窗口。
 *
 * 🔴 `totalNetMinor` 与 `paid − refunded` **故意不等**（300 ≠ 900 − 500）：
 * 界面只要是自己减出来的，这一格就会显示 4.00，而那条判据就抓不到。
 * （第一版这里写的是 400 —— 恰好等于两者之差，于是这条断言**没有牙**：
 * 换成界面自己减的实现，图照样绿。）
 *
 * ⚠️ 日期用"今天往前推"的真实日界，不用 epoch 0 —— 那张截图是要给人看的，
 * 一排 `1970-01-02` 证明不了逐日列表真的会写日期。
 */
const DAY_MS = 86_400_000;
const todayUtc = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const REVENUE = {
  window: { days: 3, offsetMinutes: -120, fromMs: todayUtc - 2 * DAY_MS, toMs: todayUtc + DAY_MS },
  series: [
    {
      currency: 'CNY',
      totalPaidMinor: 900,
      totalRefundedMinor: 500,
      totalNetMinor: 300,
      totalPaidOrders: 4,
      totalRefundedOrders: 2,
      points: [
        { dayMs: todayUtc - 2 * DAY_MS, paidMinor: 0, refundedMinor: 0, paidOrders: 0, refundedOrders: 0 },
        {
          dayMs: todayUtc - DAY_MS,
          paidMinor: 900,
          refundedMinor: 500,
          paidOrders: 4,
          refundedOrders: 2,
        },
        { dayMs: todayUtc, paidMinor: 0, refundedMinor: 0, paidOrders: 0, refundedOrders: 0 },
      ],
    },
  ],
};

/**
 * 后台的公告列表。
 *
 * 🔴 三条的 `state` 与它们的时间戳**故意互相矛盾**：jsdom 那一份已经钉过
 * "界面念的是服务端那个字段"，这一份钉的是**真浏览器里那一格的形状**——
 * 徽标、时刻区间、以及"下架"要点两次才发请求。
 */
const ANNOUNCEMENTS = {
  now: Date.now(),
  announcements: [
    {
      id: 3,
      title: '今晚维护',
      body: '同步暂停约 20 分钟。',
      level: 'warning',
      publishedAt: Date.now() + DAY_MS,
      expiresAt: Date.now() - DAY_MS,
      createdBy: 1,
      createdAt: Date.now() - 2 * DAY_MS,
      updatedAt: Date.now() - 2 * DAY_MS,
      state: 'active',
    },
    {
      id: 2,
      title: '新账号要邀请码',
      body: '注册入口暂时关闭，需要邀请码。',
      level: 'info',
      publishedAt: Date.now() - DAY_MS,
      expiresAt: null,
      createdBy: null,
      createdAt: Date.now() - DAY_MS,
      updatedAt: Date.now() - DAY_MS,
      state: 'active',
    },
  ],
};

/**
 * 后台的档位投影。
 *
 * 🔴 两处形状是这条判据的载体：
 *  · `grantDaysMax: 1234` 是一个人在界面上**写不出来**的数 —— 提示那一格如果
 *    不是读这个数（而是自己抄了一份 3650），下面那条判据就会红。
 *  · `hosted-ai-monthly` 是 `sellable: false`，而它**必须仍然出现在下拉里**：
 *    "现在发不了"与"这一档不存在"是两件事（ADR-0076 §1.3.4）。
 */
const GRANT_SKUS = {
  skus: [
    { priceId: 'hosted-monthly', grants: ['hosting'], sellable: true },
    { priceId: 'hosted-ai-monthly', grants: ['hosting', 'ai', 'automation'], sellable: false },
  ],
  grantDaysMax: 1234,
};

const GRANT_LOG = {
  items: [
    {
      id: 3,
      userId: 5,
      actorUserId: 1,
      action: 'grant',
      sku: 'hosted-monthly',
      days: 30,
      grants: ['hosting'],
      beforePeriodEnd: null,
      afterPeriodEnd: Date.now() + DAY_MS * 30,
      reason: '内测授权',
      createdAt: Date.now() - DAY_MS,
    },
    {
      id: 2,
      userId: 7,
      actorUserId: 1,
      action: 'revoke',
      sku: null,
      days: null,
      grants: [],
      beforePeriodEnd: Date.now() + DAY_MS * 3,
      afterPeriodEnd: Date.now(),
      reason: '内测结束',
      createdAt: Date.now() - 2 * DAY_MS,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
};

/**
 * 装一个只认后台那几个端点的假服务端，并把浏览器停在 `/admin`。
 *
 * @param overviewStatus 200 = 这个账号是管理员；403 = 不是。
 */
async function openConsole(page: Page, overviewStatus: number): Promise<void> {
  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-route-token', email: 'boss@example.test' }),
    );
  }, SERVER);

  await pinChineseUi(page);
  // 开机就会发的两条与本主题无关的读请求，不补位会把真正的失败淹掉
  // （理由逐字沿用 `admin-console.spec.ts` 那两条）。
  await stubLegalRecheck(page, SERVER);
  await stubPublicFacts(page, SERVER);

  await page.routeWebSocket(REALTIME_WS_GLOB, () => {
    // 保持打开即可，本支不验实时同步。
  });
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latestSeq: 0 }),
    });
  });

  await page.route(`${ADMIN}**`, async (route) => {
    const path = new URL(route.request().url()).pathname.slice('/api/admin'.length);
    if (path === '/overview') {
      await route.fulfill({
        status: overviewStatus,
        contentType: 'application/json',
        body: JSON.stringify(overviewStatus === 200 ? OVERVIEW : { error: 'forbidden' }),
      });
      return;
    }
    if (path === '/revenue') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REVENUE),
      });
      return;
    }
    if (path === '/skus') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(GRANT_SKUS),
      });
      return;
    }
    if (path === '/subscriptions/grants') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(GRANT_LOG),
      });
      return;
    }
    if (
      path === '/subscriptions/grant' ||
      path === '/subscriptions/upgrade' ||
      path === '/subscriptions/revoke'
    ) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, subscription: {}, audit: {} }),
      });
      return;
    }
    if (path === '/announcements' && route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(ANNOUNCEMENTS),
      });
      return;
    }
    if (/^\/announcements\/\d+$/.test(path) && route.request().method() === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, withdrawn: true }),
      });
      return;
    }
    if (path === '/users') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              id: 1,
              email: 'ada@example.test',
              createdAt: 1_759_000_000_000,
              verified: true,
              admin: false,
              lockedUntil: null,
              failedLoginAttempts: 0,
              storageQuotaBytes: 104_857_600,
              storageUsedBytes: 12_345,
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
      });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.goto('/admin');
  await decidePrivacyConsent(page, 'accepted');
  await waitForBootSplashGone(page);
}

test.describe('/admin 这个地址（真浏览器）', () => {
  test('后台壳画出来了，而应用本体没有', async ({ page }) => {
    await openConsole(page, 200);

    const console_ = page.getByTestId('admin-console');
    await expect(console_).toBeVisible();

    // 侧栏的每一格按**名字**点齐（`features/admin/nav.ts` 那份共享清单的界面后果）。
    // 这里刻意不写 `toHaveCount(N)`：清单加一格就把这条判据弄红，而红的是"没同步计数"
    // 这种谁也不会去读的原因。名字点齐才拦得住真错（改名、漏格、串了语言）。
    for (const label of [
      '概览',
      '用户',
      '订阅',
      '发放',
      '订单',
      '优惠码',
      '邀请',
      '营收',
      '公告',
      '调休/补班',
      '退款',
    ]) {
      await expect(console_.getByRole('button', { name: label, exact: true })).toBeVisible();
    }
    // 概览的八位数只可能来自 `/api/admin/overview` 的响应体。
    await expect(page.getByTestId('admin-panel')).toContainText('8');
    await expect(page.getByTestId('admin-panel')).toContainText('有效订阅');

    // 🔴 这一条是本支存在的另一半理由：换壳换得**干净**。
    await expect(page.locator('input[placeholder^="添加任务"]')).toHaveCount(0);
    await expect(page.locator('.ht-rail')).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE}/admin-route-console-light.png`, fullPage: true });
  });

  test('点侧栏「用户」→ 表格是那一格按需拉回来的', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(ADMIN)) calls.push(new URL(request.url()).pathname);
    });

    await openConsole(page, 200);
    await page.getByRole('button', { name: '用户', exact: true }).click();

    await expect(page.getByTestId('admin-panel')).toContainText('ada@example.test');
    expect(calls).toContain('/api/admin/users');

    await page.screenshot({ path: `${EVIDENCE}/admin-route-users.png`, fullPage: true });
  });

  test('🔴 403 ⇒ 这一页给的是原因，不是一片空白', async ({ page }) => {
    await openConsole(page, 403);

    const console_ = page.getByTestId('admin-console');
    await expect(console_).toBeVisible();
    await expect(page.getByTestId('admin-console-reason')).toContainText('当前账号没有管理后台权限');
    // 内容区一块都不许出现。
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);
    // 数字也不许出现（"没有权限"的那一屏上不该有从别处漏出来的读数）。
    await expect(console_.getByText('8', { exact: true })).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE}/admin-route-denied.png`, fullPage: true });
  });

  test('营收那一格：三个合计读数是服务端给的那三个', async ({ page }) => {
    await openConsole(page, 200);
    await page.getByRole('button', { name: '营收', exact: true }).click();

    const group = page.getByTestId('admin-revenue-CNY');
    await expect(group).toBeVisible();
    await expect(group).toContainText('3.00 CNY'); // 净：只有服务端知道这个数
    await expect(group).toContainText('9.00 CNY'); // 进账
    await expect(group).toContainText('5.00 CNY'); // 退款
    // 🔴 反向那一半才是这条判据的牙：界面自己减就会得到 4.00。
    await expect(group).not.toContainText('4.00 CNY');
    // 柱子：三天各一根（零的那两天也要有格子，只是高度为 0）。
    await expect(group.locator('rect.ht-settings__admin-revenueBarPaid')).toHaveCount(3);

    await page.screenshot({ path: `${EVIDENCE}/admin-route-revenue-light.png`, fullPage: true });
  });

  test('🔴 运营公告那一格：徽标念的是服务端的 `state`，下架要按两次', async ({ page }) => {
    const deletes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'DELETE' && request.url().startsWith(ADMIN)) {
        deletes.push(new URL(request.url()).pathname);
      }
    });

    await openConsole(page, 200);
    await page.getByRole('button', { name: '公告', exact: true }).click();

    const panel = page.getByTestId('admin-announcements');
    await expect(panel).toBeVisible();

    // 明文警告常驻 —— 这一格是往**所有用户**的界面里写明文，约束不许只在有数据时才说。
    await expect(page.getByTestId('admin-announcements-plaintext')).toContainText('明文');

    const rows = panel.locator('.ht-settings__admin-row');
    await expect(rows).toHaveCount(2);
    // 🔴 第一条的 `publishedAt` 在**未来**、`expiresAt` 在**过去**，服务端说 active。
    // 界面自己比时钟的话，无论往哪边比都会念成「还没生效」或「已过期」。
    await expect(rows.first().locator('.ht-settings__admin-badge')).toHaveText('挂着');
    // 第二条 `expiresAt = null` ⇒ 念的是服务端那个 null，不是一个 1970 的时刻。
    await expect(rows.nth(1)).toContainText('不过期');

    // 下架第一步：只出确认，一个请求都不发。
    await rows.first().getByRole('button', { name: '下架', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认下架这一条？', exact: true })).toBeVisible();
    expect(deletes).toHaveLength(0);

    await page.screenshot({ path: `${EVIDENCE}/admin-route-announcements-light.png`, fullPage: true });

    // 第二步才真的发。
    await page.getByRole('button', { name: '确认下架这一条？', exact: true }).click();
    await expect.poll(() => deletes).toEqual(['/api/admin/announcements/3']);
  });

  test('🔴 发放那一格：不可交付的档留在列表里、上界念服务端的数、收回要按两次', async ({ page }) => {
    const posts: { url: string; body: string | null }[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().startsWith(ADMIN)) {
        posts.push({ url: new URL(request.url()).pathname, body: request.postData() });
      }
    });

    await openConsole(page, 200);
    await page.getByRole('button', { name: '发放', exact: true }).click();

    const panel = page.getByTestId('admin-grants');
    await panel.waitFor();

    // 🔴 交付不了的那一档**不许从下拉里消失**：它今天是"现在发不了"，不是"不存在"，
    // 而后一种说法会让运营去翻价目表找一个并不存在的漏洞。
    const options = await panel.locator('select option').allTextContents();
    const ai = options.find((text) => text.includes('hosted-ai-monthly'));
    expect(ai).toBeDefined();
    expect(ai).toContain('现在发不了');
    expect(options.find((text) => text.startsWith('hosted-monthly'))).not.toContain('现在发不了');

    // 🔴 天数上界是**随响应给的那个数**（这里故意是 1234）。
    // 界面上写死一份的话，下一次抬上界就是两处不同步 —— 而它不会报错。
    await expect(page.getByTestId('admin-grants-daysHint')).toContainText('1234');
    await expect(page.getByTestId('admin-grants-daysHint')).not.toContainText('3650');

    // 发放记录念的是**动作史**：理由与操作者少一个，它就退化成一条状态流水。
    const rows = page.getByTestId('admin-grants-rows').locator('.ht-settings__admin-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('内测授权');
    await expect(rows.first()).toContainText('操作者 #1');
    // 收回那一行不带档位：那一档是什么由它自己那条 grant 记录说。
    await expect(rows.nth(1)).toContainText('不带档位');

    await page.screenshot({ path: `${EVIDENCE}/admin-route-grants-light.png`, fullPage: true });

    // 收回第一步：只出确认，一个 POST 都不发。
    await page.getByLabel('账号编号').fill('5');
    await page.getByLabel('理由（会进发放记录）').fill('内测结束');
    await page.getByRole('button', { name: '收回发放', exact: true }).click();
    await expect(
      page.getByRole('button', {
        name: '收回会让这个账号立刻失去赠送那一份能力（已经付费的不动）。确认吗？',
        exact: true,
      }),
    ).toBeVisible();
    expect(posts).toHaveLength(0);

    // 第二步才真的发。
    await page.getByRole('button', { name: '收回会让这个账号立刻失去', exact: false }).click();
    await expect.poll(() => posts.map((post) => post.url)).toEqual([
      '/api/admin/subscriptions/revoke',
    ]);
  });

  test('🔴「免费升级」打的是 /upgrade，而且载荷里没有 days（"一天都不加"在界面上的唯一证明）', async ({ page }) => {
    const posts: { url: string; body: string | null }[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().startsWith(ADMIN)) {
        posts.push({ url: new URL(request.url()).pathname, body: request.postData() });
      }
    });

    await openConsole(page, 200);
    await page.getByRole('button', { name: '发放', exact: true }).click();
    await page.getByTestId('admin-grants').waitFor();

    await page.getByLabel('账号编号').fill('5');
    await page.getByLabel('档位').selectOption('hosted-ai-monthly');
    // 天数那一格**故意填着**：不许界面替服务端把它抹掉（那等于界面在裁决），
    // 但它也**不许被发出去** —— 载荷里没有 days 才是这条判据。
    await page.getByLabel('天数（只有「赠送」用得到）').fill('30');
    await page.getByLabel('理由（会进发放记录）').fill('内测授权');

    await page.getByRole('button', { name: '免费升级', exact: true }).click();

    await expect.poll(() => posts.map((post) => post.url)).toEqual([
      '/api/admin/subscriptions/upgrade',
    ]);
    const body = JSON.parse(posts[0]!.body ?? '{}') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['reason', 'sku', 'userId']);
    expect(body).toEqual({ userId: 5, sku: 'hosted-ai-monthly', reason: '内测授权' });
  });

  test('🔴 暗色主题下这一页仍然读得下去（AGENTS §5：不测暗色就交付是明令的错法）', async ({ page }) => {
    // 走**生产读路径**：`lib/theme.ts` 的 `resolveInitialTheme()` 读的就是这一枚 key，
    // 优先级是"用户已选 > 系统偏好"，所以这里种的是"用户选过 dark"，
    // 而不是 `emulateMedia` —— 后者会被那一条优先级盖掉（theme.ts 的注释
    // 逐字记着这个症状："刷新之后 `<html data-theme>` 仍是 light"）。
    await page.addInitScript(() => {
      localStorage.setItem('heyta.theme', 'dark');
    });
    await openConsole(page, 200);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: '营收', exact: true }).click();
    await expect(page.getByTestId('admin-revenue-CNY')).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE}/admin-route-console-dark.png`, fullPage: true });

    // 暗色不是亮色的反相：这里量的是"字还看得见"——顶栏标题的前景色
    // 不能等于它所在顶栏的背景色。
    const contrast = await page.evaluate(() => {
      const title = document.querySelector('.ht-settings__console-title');
      const bar = document.querySelector('.ht-settings__console-bar');
      if (title === null || bar === null) return null;
      return {
        fg: getComputedStyle(title).color,
        bg: getComputedStyle(bar).backgroundColor,
      };
    });
    expect(contrast).not.toBeNull();
    expect(contrast!.fg).not.toBe(contrast!.bg);

    // 🔴 新加的那一格也要在暗色下**各量一发**：只拍营收那一屏的话，
    // "暗色只剩一条腿量得到"就是这一仓记过的探针陷阱 —— 换色的是 token，
    // 而新格子用的是 `ht-settings__hint`，它有没有暗色分支只有这里知道。
    await page.getByRole('button', { name: '发放', exact: true }).click();
    await expect(page.getByTestId('admin-grants')).toBeVisible();
    // 等它**装完**再拍：停在加载态的暗色截图只证明了"加载那一行有暗色分支"，
    // 而下拉与记录行才是这一格里唯一带自己颜色的两块。
    await expect(
      page.getByTestId('admin-grants-rows').locator('.ht-settings__admin-row'),
    ).toHaveCount(2);
    await page.screenshot({ path: `${EVIDENCE}/admin-route-grants-dark.png`, fullPage: true });

    // 判据是"字还看得见"，不是"两个颜色不相等"（后者拿一个透明背景就能假过）。
    // 暗色下说明文字的前景色相对亮度必须够高 —— 把 hint 写成深灰就会红在这里。
    const ink = await page.evaluate(() => {
      const lead = document.querySelector('[data-testid="admin-grants-lead"]');
      if (lead === null) return null;
      const match = /rgba?\((\d+)[^)]*?(\d+)[^)]*?(\d+)/u.exec(getComputedStyle(lead).color);
      if (match === null) return null;
      const [r, g, b] = [1, 2, 3].map((i) => Number(match[i]) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    });
    expect(ink).not.toBeNull();
    expect(ink!).toBeGreaterThan(0.35);
  });

  test('应用入口仍然完好：同一个 bundle 挂在 / 时照常是任务视图', async ({ page }) => {
    await openConsole(page, 200);
    await page.getByRole('link', { name: '返回应用' }).click();

    // 「返回应用」走的是构建期 base（dev 是 `/`），落回去之后任务视图在。
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  });
});
