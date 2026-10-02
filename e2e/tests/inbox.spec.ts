import { expect, test } from '@playwright/test';
import { openApp, stubLegalRecheck } from './helpers';

/**
 * 通知中心 + 活动（福利中心）：真浏览器契约。
 *
 * ## 🔴 这里"假"的只有**服务端的响应体**，不是产品行为
 *
 * 与 `stub-provider.mjs` 同一条纪律：被测对象是**真的** —— 真 DOM、真
 * IndexedDB、真的 `fetch`、真的 store、真的组件树。只有"同步服务端回了什么"
 * 是造出来的，因为这一套 e2e **不跑真服务端**（它要 PostgreSQL）。
 *
 * 用 `page.route` 直接拦这两个端点，比往 `stub-provider.mjs` 里加接口更合适：
 * 那个假端点的职责是"假装一个模型服务"，而这两个接口属于**同步服务端**，
 * 混在一起会让"这一条到底在测谁"变得含糊。
 *
 * ## 为什么要先往 localStorage 里塞凭据
 *
 * `baseUrl` 为空时 `fetchAccountNotifications` **连请求都不发**（fail-open，
 * 见 `inbox.ts`），面板会显示"配置同步服务器之后…"。那是**正确行为**，
 * 但那样就看不到列表本身了。所以这里先塞一份凭据，让 baseUrl 非空。
 *
 * ## 截图是硬性要求
 *
 * 见 AGENTS.md §6.2 规定一：任何"界面能用"的结论只有截图能作为证据，
 * 而**人必须打开看一眼**。三条截图分别对应：徽标（面板关着）、通知 Tab、
 * 活动 Tab —— 面板的位置（`position: fixed` 不被 rail 裁剪）只有图能证明。
 */

/** 与 `playwright.config.ts` 的 stub 端口一致；这里只当"一个非空的服务器地址"用。 */
const SERVER = 'http://127.0.0.1:4319';

const NOTIFICATIONS_BODY = {
  notifications: [
    {
      id: 2,
      kind: 'referral-activated',
      payload: { displayName: 'star', days: 5 },
      createdAt: Date.UTC(2026, 8, 26, 4, 0, 0),
      readAt: null,
    },
    {
      id: 1,
      kind: 'referral-activated',
      payload: { displayName: null, days: 5 },
      createdAt: Date.UTC(2026, 8, 25, 4, 0, 0),
      readAt: Date.UTC(2026, 8, 25, 5, 0, 0),
    },
    {
      // 🔴 未知 kind：老客户端遇到服务端新加的事件。它**必须被跳过**
      // （渲染出来就是一张空白卡片），而且不能让上面两条消失。
      id: 3,
      kind: 'spring-festival-2027',
      payload: { whatever: true },
      createdAt: Date.UTC(2026, 8, 27, 4, 0, 0),
      readAt: null,
    },
  ],
  unreadCount: 2,
};

const ACTIVITY_BODY = {
  campaigns: [
    {
      id: 'invite-friends',
      kind: 'invite',
      invite: {
        inviteCode: 'ABCD2345',
        rewardDays: 5,
        invited: 3,
        activated: 2,
        daysEarned: 10,
        windowInvited: 3,
        windowCap: 20,
        windowDays: 30,
        referrals: [
          {
            code: 'ABCD2345',
            displayName: 'star',
            createdAt: Date.UTC(2026, 8, 26, 4, 0, 0),
            activatedAt: Date.UTC(2026, 8, 26, 6, 0, 0),
            rewardDays: 5,
          },
          {
            code: 'ABCD2345',
            displayName: null,
            createdAt: Date.UTC(2026, 8, 25, 4, 0, 0),
            activatedAt: null,
            rewardDays: null,
          },
        ],
      },
    },
  ],
};

async function seedServerAndStubRoutes(page: import('@playwright/test').Page): Promise<void> {
  // 在应用脚本执行**之前**把凭据塞进 localStorage（`addInitScript` 就是这个时机）。
  // ⚠️ 生产者垫片不在这里装 —— `openApp` 那一步会装（同一个 `page.route`，
  // 注册两次会让后一份把前一份**静默遮掉**，`ACTIVE_SHIMS` 的报告因此会失真）。
  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-token', email: 'me@example.com' }),
    );
  }, SERVER);

  // 🔴 补签那道读侧闸：塞了凭据应用一启动就会问一次，与通知这个主题无关。
  await stubLegalRecheck(page, SERVER);

  await page.route(`${SERVER}/api/notifications**`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ updated: 2, unreadCount: 0 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(NOTIFICATIONS_BODY),
    });
  });

  await page.routeWebSocket(REALTIME_WS_GLOB, () => {
    // 故意什么都不做：保持连接打开即可（本用例不验实时同步）。
  });

  // 权益探测（`fetchHostedEntitlementReading` 打的是 `/api/sync/status`）。
  // 塞了凭据之后它就会发，所以要给这个假服务端补上 —— 否则控制台与
  // "非 2xx" 断言里会混进一个与本主题无关的 404，把真正的失败淹掉。
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latestSeq: 0 }),
    });
  });

  await page.route(`${SERVER}/api/activity**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(ACTIVITY_BODY),
    });
  });
}

/**
 * 🔴 控制台与页面错误必须被抓下来（AGENTS.md §6.2 规定一第 3 条）。
 *
 * 这一条不是形式：**白屏与"点了没反应"的根因几乎只在这里现形**
 * （模块 404、CSP 拦脚本、React 抛错）。监听要在**页面创建时**就挂上 ——
 * 挂晚了收不到加载期错误，输出会显示"控制台无内容"，那是最误导人的结果。
 */
interface PageProblems {
  /** 控制台 error 的正文。 */
  readonly consoleErrors: string[];
  /** 未捕获异常（与"资源 404"无关，那些走 `badResponses`）。 */
  readonly pageErrors: string[];
  /** 非 2xx 响应的**路径**（带 URL，所以能逐条登记）。 */
  readonly badResponses: string[];
}

function captureProblems(page: import('@playwright/test').Page): PageProblems {
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

/**
 * 🔴 已登记的**已知缺失资源**。
 *
 * 本仓库从来没有 favicon（`apps/web/index.html` 无引用、无 `public/`、
 * git 里一个 `.ico` 都没有）。这与 `motivation.spec.ts` 的 `KNOWN_MISSING`
 * 是同一条登记 —— 那边也写着同一句理由：**登记具体路径，而不是过滤 "404" 字样**，
 * 后者会把将来真正坏掉的资源一起藏掉。
 *
 * ⚠️ 实时同步的 WebSocket 不在这里：它由 `routeWebSocket` 接管，
 * 所以它根本不该产生 404（真产生了就是这条断言该抓的东西）。
 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

function assertNoProblems(problems: PageProblems): void {
  const unexpected = problems.badResponses.filter(
    (path) => !KNOWN_MISSING.some((known) => path === known),
  );
  expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);

  // "Failed to load resource" 那类已由上面的 URL 断言精确覆盖
  // （控制台那行**不带 URL**，所以它自己没法用来定位）。
  const nonResource = problems.consoleErrors.filter(
    (text) => !/Failed to load resource/u.test(text),
  );
  expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  expect(problems.pageErrors, `不该有未捕获异常：${JSON.stringify(problems.pageErrors)}`).toEqual(
    [],
  );
}

/**
 * 🔴 把实时同步的 WebSocket **接管掉**，而不是"把它的报错过滤掉"。
 *
 * 塞了同步凭据之后，应用会真的去连 `ws://…/api/sync/ws`。本套件的
 * `stub-provider.mjs` 是一个"假装模型服务"的 HTTP 端点，没有 WS 路由 ——
 * 于是握手 404，Chromium 在控制台打一行**不带 URL 的**
 * `Failed to load resource: … 404`。
 *
 * 那一行没法按 URL 过滤（它就是不给 URL），而按"404"过滤会把**真的**
 * 资源 404 一起藏掉。所以这里用它该有的办法：`routeWebSocket` 把这条连接
 * 接住并保持打开 —— 产品行为（连上去）照常发生，只是对端由测试提供。
 */
const REALTIME_WS_GLOB = 'ws://127.0.0.1:4319/api/sync/ws*';

test.describe('通知中心 + 活动', () => {
  test('rail 底部铃铛 → 面板两个 Tab，内容与徽标都对', async ({ page }) => {
    const problems = captureProblems(page);
    const posts: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') posts.push(`${req.method()} ${req.url()}`);
    });

    await seedServerAndStubRoutes(page);
    // 🔴 `accepted`：这三条的"数据真的进了面板"依赖 `page.route` 接住的那些
    // 请求 —— 而隐私闸门换掉的是**整个** `window.fetch`，`local-only` 下
    // 一个字节都不出门，路由处理器一次都不会被调用，症状是"面板空着"，
    // 长得像产品坏了。首启同意不是本主题的判据（那是 `privacy-consent-zero-egress`）。
    await openApp(page, '/', 'accepted');

    // ── 面板关着：铃铛在 rail 底部，带未读徽标 ────────────────────────────
    const trigger = page.getByTestId('inbox-trigger');
    await expect(trigger).toBeVisible();
    await expect(page.getByTestId('inbox-badge')).toHaveText('2');

    // 🔴 它**不是** `role="tab"` —— 那两条 e2e（smoke / motivation）把 rail 上
    // 的 tab 数量与文案钉死了，而铃铛是一个**动作**（打开面板），不是视图。
    await expect(page.getByTestId('inbox-trigger')).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );

    // 先截图，再断言（AGENTS.md §6.2 规定一第 1 条：失败时也要有图）。
    await page.screenshot({ path: 'test-results/inbox-closed.png', fullPage: false });

    // ── 打开：通知 Tab ───────────────────────────────────────────────────
    await trigger.click();
    await expect(page.getByTestId('inbox-panel')).toBeVisible();

    // 两条能渲染的通知都在（未知 kind 那条被跳过，且**没有**把别的挤掉）。
    await expect(page.getByTestId('inbox-item-2')).toBeVisible();
    await expect(page.getByTestId('inbox-item-1')).toBeVisible();
    await expect(page.getByTestId('inbox-item-3')).toHaveCount(0);
    await expect(page.getByTestId('inbox-list').locator('li')).toHaveCount(2);

    // 没名字的那条走"一位好友"的兜底文案，而不是渲染出一个空名字。
    await expect(page.getByTestId('inbox-item-1')).toContainText('一位好友');
    // 有名字的那条用展示名。
    await expect(page.getByTestId('inbox-item-2')).toContainText('star');

    await page.screenshot({
      path: 'test-results/inbox-notifications.png',
      fullPage: false,
    });

    // ── 全部已读：徽标消失 ───────────────────────────────────────────────
    await page.getByTestId('inbox-mark-all-read').click();
    try {
      await expect(page.getByTestId('inbox-badge')).toHaveCount(0);
    } catch (err) {
      // 失败时把诊断一起打出来：请求去了哪里、控制台说了什么。
      console.log('POST requests seen:', JSON.stringify(posts, null, 2));
      console.log('page problems:', JSON.stringify(problems, null, 2));
      throw err;
    }

    // ── 活动 Tab ─────────────────────────────────────────────────────────
    await page.getByTestId('inbox-tab-activity').click();
    await expect(page.getByTestId('inbox-invite-code')).toHaveText('ABCD2345');
    await expect(page.getByTestId('inbox-invite-stats')).toContainText('3');
    await expect(page.getByTestId('inbox-invite-stats')).toContainText('10');
    await expect(page.getByTestId('inbox-invite-list').locator('li')).toHaveCount(2);

    await page.screenshot({
      path: 'test-results/inbox-activity.png',
      fullPage: false,
    });

    // ── Escape 关掉（焦点可能已经不在面板里，所以监听挂在 document 上）──
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inbox-panel')).toHaveCount(0);

    assertNoProblems(problems);
  });

  test('🔴 空态走共享实现（截图为证：它在面板里长什么样）', async ({ page }) => {
    const problems = captureProblems(page);
    await page.addInitScript((server: string) => {
      localStorage.setItem(
        'heyta.sync.credentials',
        JSON.stringify({ baseUrl: server, token: 'e2e-token', email: 'me@example.com' }),
      );
    }, SERVER);

    // 🔴 同上：这一条也塞了凭据，启动时必然问一次补签状态。
    await stubLegalRecheck(page, SERVER);

    // 通知与活动都空。
    await page.route(`${SERVER}/api/notifications**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ notifications: [], unreadCount: 0 }),
      });
    });
    await page.route(`${SERVER}/api/activity**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ campaigns: [] }),
      });
    });
    await page.route(`${SERVER}/api/sync/status**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ latestSeq: 0 }),
      });
    });
    await page.routeWebSocket(REALTIME_WS_GLOB, () => {
      // 保持打开即可。
    });

    // 🔴 `accepted` 是这条判据的**前提**：它要的是"请求真的发出去了、服务端真的
    // 回了空列表"，不是"请求被隐私闸门拦下、面板于是空着"。两种空在界面上
    // 长得一样，而后者会让这一条永远通过。
    await openApp(page, '/', 'accepted');

    await page.getByTestId('inbox-trigger').click();
    await expect(page.getByTestId('inbox-empty')).toBeVisible();
    await page.screenshot({ path: 'test-results/inbox-empty.png', fullPage: false });

    await page.getByTestId('inbox-tab-activity').click();
    await expect(page.getByTestId('inbox-activity-empty')).toBeVisible();
    await page.screenshot({
      path: 'test-results/inbox-activity-empty.png',
      fullPage: false,
    });

    assertNoProblems(problems);
  });

  test('没配同步服务器时，面板说"先配置服务器"而不是"加载失败"', async ({ page }) => {
    const problems = captureProblems(page);
    // 刻意**不**塞凭据（`baseUrl` 留在空 = 没配服务器）。
    //
    // 🔴 但同意档必须是 `accepted`，共享层的默认档在这里会测到**另一个分支** ——
    // 2026-10-02 实测：用 `local-only` 时面板渲染的是空态「还没有通知」，
    // `inbox-unconfigured` 根本不在 DOM 里。机制在 `InboxBell.tsx:313` 的
    // `pollNotifications()`：`networkAllowed()` 为假时它**提前 return、不改状态**，
    // 于是界面停在"还没拉过"（那是刻意的 —— 见那里的注释："闸门保证发不出去，
    // 这一处保证界面不说谎"）。而 `unconfigured` 是**拉了之后**由
    // `fetchAccountNotifications` 返回的读态（`store.ts:115`：地址为空时它自己就
    // 归成 `unconfigured`，一个字节都不发）。
    //
    // 所以这一条的判据形态要求"允许出门"与"没有地址"**同时成立**：
    // `local-only` 下两者都成立的是空态，不是这条要钉的那句话。
    await openApp(page, '/', 'accepted');

    await page.getByTestId('inbox-trigger').click();
    await expect(page.getByTestId('inbox-unconfigured')).toBeVisible();
    // 这一条是"两种失败必须分开说"的守卫：合并成一句会让自托管用户
    // 去排查一个根本不存在的故障。
    await expect(page.getByTestId('inbox-unavailable')).toHaveCount(0);

    await page.screenshot({
      path: 'test-results/inbox-unconfigured.png',
      fullPage: false,
    });

    assertNoProblems(problems);
  });
});
