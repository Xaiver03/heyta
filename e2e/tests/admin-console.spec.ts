import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, openSettingsView, stubLegalRecheck, stubPublicFacts } from './helpers';

/**
 * 运营管理后台：真浏览器契约（截图为判据）。
 * ============================================
 *
 * ## 这一支原来缺的是什么
 *
 * 后台的**判据**在 jsdom 与服务端两侧都齐（`server/tests/admin-*.spec.ts` 26 条、
 * `apps/web/tests/admin-panel.spec.tsx`、`packages/app-host/tests/admin-client.spec.ts`），
 * 而 `e2e/` 目录下 grep `admin` 是**零命中**。按 AGENTS §6.2 规定一，
 * "界面能用"这个结论原来**没有任何一张图支撑**。
 * 而 §7 第 80 条记的正是这一类：jsdom 里 `window.dispatchEvent` 不走
 * "输入框 → 冒泡 → window"那条被 RN-web 吞掉的路，**测试绿 ≠ 真浏览器里能用**。
 *
 * ## 🔴 这里"假"的只有**服务端的响应体**，不是产品行为
 *
 * 与 `stub-provider.mjs` 同一条纪律：被测对象是真的 —— 真 DOM、真 `fetch`、
 * 真 store、真组件树、真点六个 Tab。只有"同步服务端回了什么"是造的，
 * 因为这一套 e2e **不跑真服务端**（它要 PostgreSQL）。
 *
 * ## 为什么这些判据必须**读回服务端的值**才算数
 *
 * `store.ts` 的三个动作在成功后都写了一句 `await get().openUser(id)` ——
 * "动作改的是服务端状态 ⇒ 必须重新拉，不能只改本地副本"。光断言"界面上出现了
 * 已完成"挡不住只改本地的实现（那是 §7 第 50 条：'状态对'在'没生效'时也绿）。
 * 所以这里让**假服务端自己变**（`fake.locked` / `fake.failedLogins` / `fake.quotaBytes`），
 * 界面要显示新值，只有一条路：真的把 POST 打出去、再把 GET 拉回来。
 * 拿掉那句重新拉 ⇒ 界面停在旧值 ⇒ 红。
 *
 * ## ⚠️ 助手函数**刻意不放进 `helpers.ts`**
 *
 * `captureProblems` / `stat` 与 `inbox.spec.ts` 里的同形。本仓库的教训是
 * "抽取的收尾动作是删掉旧的那份并加门禁，不是写一个更好的新版本"（AGENTS §3.5），
 * 而这里两既都不动：`helpers.ts` 与 `inbox.spec.ts` 此刻正被另一条会话改着
 * （M3 共享 UI 迁移），并发改共享文件会撞车。第三次出现时再抽，并且一次抽干净。
 */

/** 与 `playwright.config.ts` 的 stub 端口一致；这里只当"一个非空的服务器地址"用。 */
const SERVER = 'http://127.0.0.1:4319';
const ADMIN = `${SERVER}/api/admin`;
/**
 * 🔴 裁 `url.pathname` 只能用**这个**长度，不能用 `ADMIN.length`。
 * `ADMIN` 是带协议与端口的完整来源（31 个字符），而 `url.pathname` 只有
 * `/api/admin/overview`（19 个）—— 拿前者裁后者会得到空串，
 * 于是每一个分支都落空、全部请求都掉到最后那条 404。
 * 症状是"面板一块都不渲染"，看起来像产品缺陷，实际坏的是探针。
 */
const ADMIN_PATH = new URL(ADMIN).pathname;
/** 塞了凭据之后应用会真去连它，对端由测试提供（同 `inbox.spec.ts` 的处理）。 */
const REALTIME_WS_GLOB = 'ws://127.0.0.1:4319/api/sync/ws*';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 20, 4, 0, 0);

/**
 * 判据②那两条出处。🔴 假服务端的响应与下面的断言**共用这一个常量** ——
 * 抄两份的漂移形状是"改了夹具没改期望"，那条判据就悄悄变成只对自己成立。
 */
const HOLIDAY_PAPERS = [
  'https://www.gov.cn/zhengce/content/2025-11/holiday-2026.pdf',
  'https://www.gov.cn/zhengce/content/2025-11/make-up-2026.pdf',
] as const;

/** 详情页那台"假服务端"的可变状态。界面的新值只能从这里读回来。 */
interface FakeServerState {
  locked: boolean;
  lockedUntil: number | null;
  failedLogins: number;
  quotaBytes: number;
  tokenVersion: number;
}

function defaultFake(): FakeServerState {
  return {
    locked: true,
    lockedUntil: T0 + DAY,
    failedLogins: 5,
    quotaBytes: 104_857_600, // 100 MiB
    tokenVersion: 3,
  };
}

/**
 * `GET /api/admin/refunds` 的两行（投影 = 服务端 `listRefunds` 选的那 9 个键，**逐键对齐**）。
 *
 * ⚠️ 取值刻意**互不重叠**：`4012` 分 / `30` 天 / `#1207` / `3304` / `7719` /
 * `HYRFDEMO0001` —— "投影里每个字段都画出来了"这条存在性判据，
 * 只有在各值不会互相冒充时才有牙（两个金额都填 400 那种写法判不出来）。
 */
function refundRows() {
  return [
    {
      id: 1207,
      orderId: 3304,
      userId: 7719,
      provider: 'wechat',
      outRefundNo: 'HYRFDEMO0001',
      amountMinor: 4012,
      currency: 'CNY',
      periodDays: 30,
      status: 'requested',
    },
    {
      id: 1206,
      orderId: 3301,
      userId: 7718,
      provider: 'wechat',
      outRefundNo: 'HYRFDEMO0002',
      amountMinor: 1299,
      currency: 'CNY',
      periodDays: 30,
      status: 'success',
    },
  ];
}

const OVERVIEW_BODY = {
  users: { total: 8, verified: 6, admins: 1, locked: 2 },
  subscriptions: {
    total: 4,
    active: 2,
    entitledStatuses: ['active'],
    byStatus: [
      { status: 'active', count: 2 },
      { status: 'cancelled', count: 2 },
    ],
  },
  orders: {
    total: 5,
    byStatus: [{ status: 'paid', count: 3 }],
    paidByCurrency: [
      { currency: 'CNY', paidOrders: 3, revenueMinor: 3900 },
      { currency: 'USD', paidOrders: 1, revenueMinor: 990 },
    ],
  },
  coupons: { total: 3, enabled: 2, settledRedemptions: 7 },
  invites: {
    codes: 5,
    codesDisabled: 1,
    referrals: 4,
    referralsActivated: 2,
    referralsRewarded: 2,
  },
};

/**
 * 用户列表。🔴 id 7 那一行的 `locked` 必须跟着假服务端走 ——
 * 这样"列表徽标在解锁后消失"才**只能**靠重拉列表实现（本地补丁骗不过去）。
 */
function usersPageBody(fake: FakeServerState) {
  return {
    items: [
      {
        id: 1,
        email: 'boss@example.test',
        isVerified: true,
        isAdmin: true,
        locked: false,
        lockedUntil: null,
        createdAt: T0,
        storageUsedBytes: 1_048_576,
        storageQuotaBytes: 104_857_600,
      },
      {
        id: 7,
        email: 'locked@example.test',
        isVerified: true,
        isAdmin: false,
        locked: fake.locked,
        lockedUntil: fake.lockedUntil,
        createdAt: T0 + DAY,
        storageUsedBytes: 1_258_291,
        storageQuotaBytes: fake.quotaBytes,
      },
      {
        id: 9,
        email: 'newcomer@example.test',
        isVerified: false,
        isAdmin: false,
        locked: false,
        lockedUntil: null,
        createdAt: T0 + 2 * DAY,
        storageUsedBytes: 0,
        storageQuotaBytes: 104_857_600,
      },
    ],
    total: 8,
    limit: 50,
    offset: 0,
  };
}

function detailBody(fake: FakeServerState) {
  return {
    user: {
      id: 7,
      email: 'locked@example.test',
      isVerified: true,
      isAdmin: false,
      locked: fake.locked,
      lockedUntil: fake.lockedUntil,
      createdAt: T0 + DAY,
      storageUsedBytes: 1_258_291,
      storageQuotaBytes: fake.quotaBytes,
      failedLoginAttempts: fake.failedLogins,
      termsAcceptedAt: null,
      tokenVersion: fake.tokenVersion,
    },
    counts: { passkeys: 2, operations: 41, notifications: 3 },
    subscriptions: [
      {
        id: 11,
        provider: 'apple',
        priceId: 'litopia-yearly',
        status: 'active',
        grants: ['hosting'],
        currentPeriodEnd: T0 + 30 * DAY,
        createdAt: T0,
        updatedAt: T0,
      },
    ],
    orders: [
      {
        id: 21,
        outTradeNo: 'HT-2026-0001',
        provider: 'wechat',
        priceId: 'litopia-monthly',
        currency: 'CNY',
        finalAmountMinor: 1900,
        discountMinor: 0,
        status: 'paid',
        createdAt: T0,
        paidAt: T0,
      },
    ],
    devices: [
      { clientId: 'dev-a', deviceName: 'iPhone 15 Pro', appVersion: '0.9.0', lastSeenAt: T0 },
      { clientId: 'dev-b', deviceName: null, appVersion: null, lastSeenAt: T0 + DAY },
    ],
  };
}

/** 装好一次会话：真应用 + 一份凭据 + 一台会答 `/api/admin/*` 的假服务端。 */
async function seed({
  page,
  overviewStatus = 200,
  fake = defaultFake(),
  refundDenyReason = null,
}: {
  page: Page;
  /** 403 用来演"非管理员什么都不渲染"。 */
  overviewStatus?: number;
  fake?: FakeServerState;
  /**
   * 非 `null` ⇒ `POST /api/admin/refunds` 以 **409 + 这个原因码**回答。
   *
   * 🔴 这一格是 ADR-0053 §5 第 11 条那条判据的载体：409 体里的 `reason` 必须**一路走到界面**。
   * 只断言"有一条错误行"挡不住把 409 折成一句"服务端出错了"的实现 —— 而那正是这一片
   * 界面存在的理由（运营分不清"这一单过了 7 天"与"这条已经决定过了"就会反复点同一个按钮）。
   */
  refundDenyReason?: string | null;
}): Promise<{ adminCalls: string[] }> {
  // ⚠️ 生产者垫片由 `openApp` 装（同 `inbox.spec.ts`：`page.route` 注册两次会让
  // 后一份把前一份静默遮掉）。
  await page.addInitScript((server: string) => {
    localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: server, token: 'e2e-admin-token', email: 'boss@example.test' }),
    );
  }, SERVER);

  // 🔴 补签那道读侧闸：塞了凭据应用一启动就会问一次，与后台这个主题无关。
  await stubLegalRecheck(page, SERVER);
  // 🔴 同一条理由的第二例，而且是**本批自己带来的**：W4b 的公共事实通道挂在
  // `apps/web/src/main.tsx:152 startPublicFacts()` ⇒ 一开机就发 `GET /api/holiday-adjustments`。
  // 2026-10-04 03:0x 实测：不补它 ⇒ 本套件**一次红五条**，五条报错逐字相同
  // （`除已登记缺失外不该有非 2xx：["/api/holiday-adjustments"]`），其中四条与后台无关。
  await stubPublicFacts(page, SERVER);

  // 实时同步的 WS 与权益探测：塞了凭据应用就会真发，对端得补上，
  // 否则无关的 404 会淹掉真正的失败（同 `inbox.spec.ts` 的理由）。
  await page.routeWebSocket(REALTIME_WS_GLOB, () => {
    // 保持打开即可，本用例不验实时同步。
  });
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ latestSeq: 0 }),
    });
  });

  // 🔴 塞了凭据之后，这三条也会真的发出去，而假端点**只实现了模型接口** ——
  // 落到它身上就是 404，混进"不该有非 2xx"里把真正的失败淹掉
  // （同 `inbox.spec.ts` 给 `/api/sync/status` 补位的理由）。
  // 这里给的是**空但合法**的响应：本支用例不验通知、不验通行密钥。
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
  // 设置页上的 PasskeyPanel 一挂载就列表 —— 本用例打开的正是设置页。
  await page.route(`${SERVER}/api/passkeys**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ passkeys: [] }),
    });
  });
  // 🔴 同一条补位纪律，2026-10-03 多了一条：资料面板（`ProfilePanel.tsx:122` →
  // `hosted-auth.ts#getAccountProfile`）一挂载就读 `/api/account/profile`，
  // 而假端点只实现了模型接口 ⇒ 404 混进"不该有非 2xx"。
  // 这里给的是**空但合法**的资料（形状逐字段抄 `accountProfileResponseSchema`：
  // `displayName` / `avatarHash` 两个都可 `null`，本支用例不验资料编辑）。
  await page.route(`${SERVER}/api/account/profile**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ displayName: null, avatarHash: null }),
    });
  });


  const adminCalls: string[] = [];

  // ⚠️ 这一条 glob 写错（少一个斜杠）的**症状不是静默通过**，而是两样都会响：
  // 请求回落到 `stub-provider.mjs` 拿 404 ⇒ `assertNoProblems` 的"不该有非 2xx"红；
  // 而"六个 Tab 各自按需拉数据"那条对 `adminCalls` 的逐字断言也红。
  // 🔴 退款那两条端点**带状态**：批准之后 `GET /refunds` 必须回一个新状态，
  // 否则界面只要"把请求里的话再印一遍"就能通过（§7 第 50 条那一族）。
  const refunds = {
    rows: refundRows().map((row) => ({ ...row })),
  };

  await page.route(`${ADMIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(ADMIN_PATH.length); // 例如 '/users/7/unlock'
    const method = route.request().method();
    adminCalls.push(`${method} ${path}${url.search}`);

    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/overview') {
      if (overviewStatus !== 200) {
        await route.fulfill({ status: overviewStatus, contentType: 'application/json', body: '{}' });
        return;
      }
      await json(OVERVIEW_BODY);
      return;
    }
    // 探测被拒之后，界面已经 return null，不会再发请求 —— 走到这里就是不该发生的事。
    if (overviewStatus !== 200) {
      await route.fulfill({ status: overviewStatus, contentType: 'application/json', body: '{}' });
      return;
    }
    if (path === '/users') {
      await json(usersPageBody(fake));
      return;
    }
    if (path === '/subscriptions') {
      await json({
        items: [
          {
            id: 11,
            userId: 7,
            email: 'locked@example.test',
            provider: 'apple',
            priceId: 'litopia-yearly',
            status: 'active',
            grants: ['hosting'],
            currentPeriodEnd: T0 + 30 * DAY,
            createdAt: T0,
          },
          {
            id: 12,
            userId: 9,
            email: 'newcomer@example.test',
            provider: null,
            priceId: null,
            status: 'cancelled',
            grants: [],
            currentPeriodEnd: null,
            createdAt: T0 + DAY,
          },
        ],
        total: 4,
        limit: 50,
        offset: 0,
      });
      return;
    }
    if (path === '/orders') {
      await json({
        items: [
          {
            id: 21,
            outTradeNo: 'HT-2026-0001',
            userId: 7,
            email: 'locked@example.test',
            provider: 'wechat',
            priceId: 'litopia-monthly',
            currency: 'CNY',
            region: 'CN',
            originalAmountMinor: 1900,
            discountMinor: 0,
            finalAmountMinor: 1900,
            status: 'paid',
            createdAt: T0,
            paidAt: T0,
          },
          {
            id: 22,
            outTradeNo: 'HT-2026-0002',
            userId: 1,
            email: 'boss@example.test',
            provider: 'stripe',
            priceId: 'litopia-yearly',
            currency: 'USD',
            region: 'US',
            originalAmountMinor: 990,
            discountMinor: 90,
            finalAmountMinor: 900,
            status: 'paid',
            createdAt: T0 + DAY,
            paidAt: T0 + DAY,
          },
          {
            id: 23,
            outTradeNo: 'HT-2026-0003',
            userId: 9,
            email: 'newcomer@example.test',
            provider: 'wechat',
            priceId: 'litopia-monthly',
            currency: 'CNY',
            region: 'CN',
            originalAmountMinor: 1200,
            discountMinor: 0,
            finalAmountMinor: 1200,
            status: 'created',
            createdAt: T0 + 2 * DAY,
            paidAt: null,
          },
        ],
        total: 5,
        limit: 50,
        offset: 0,
      });
      return;
    }
    if (path === '/coupons') {
      await json({
        items: [
          {
            id: 'c-1',
            code: 'LAUNCH20',
            name: '上线二十折',
            kind: 'percent',
            percentOffBp: 2000,
            amountOffMinor: null,
            currency: 'CNY',
            enabled: true,
            validFrom: T0,
            validUntil: null,
            maxRedemptions: 100,
            redemptions: 7,
          },
          {
            id: 'c-2',
            code: null,
            name: '内部体验',
            kind: 'amount',
            percentOffBp: null,
            amountOffMinor: 500,
            currency: 'CNY',
            enabled: false,
            validFrom: T0,
            validUntil: T0 + 9 * DAY,
            maxRedemptions: null,
            redemptions: 0,
          },
        ],
        total: 3,
        limit: 50,
        offset: 0,
      });
      return;
    }
    if (path === '/invites') {
      await json({
        codes: {
          items: [
            { id: 31, code: 'ABCD2345', disabled: false, createdAt: T0, userId: 1, email: 'boss@example.test' },
          ],
          total: 5,
          limit: 50,
          offset: 0,
        },
        referrals: {
          items: [
            {
              id: 41,
              code: 'ABCD2345',
              createdAt: T0,
              activatedAt: T0 + DAY,
              rewardDays: 5,
              rewardedAt: T0 + DAY,
              inviter: { id: 1, email: 'boss@example.test' },
              invitee: { id: 7, email: 'locked@example.test' },
            },
          ],
          total: 4,
          limit: 50,
          offset: 0,
        },
      });
      return;
    }
    // ── 退款四条端点 ───────────────────────────────────────────────
    if (path === '/refunds' && method === 'GET') {
      await json({ refunds: refunds.rows });
      return;
    }
    if (path === '/refunds' && method === 'POST') {
      const body = route.request().postDataJSON() as {
        orderId: number;
        note?: string;
        operatorApproved?: boolean;
      };
      if (refundDenyReason !== null) {
        // 🔴 409 + 体里的**机器码**：这一格要验的就是这个码能不能走到界面。
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Refund not allowed.', reason: refundDenyReason }),
        });
        return;
      }
      const id = Math.max(...refunds.rows.map((row) => Number(row.id)), 9000) + 1;
      refunds.rows.unshift({ ...refundRows()[0], id, orderId: body.orderId });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          outcome: 'requested',
          refundId: id,
          outRefundNo: `HYRFNEW${String(id)}`,
          amountMinor: 4012,
        }),
      });
      return;
    }
    const decided = /^\/refunds\/(\d+)\/(approve|reject)$/.exec(path);
    if (decided !== null) {
      const row = refunds.rows.find((entry) => entry.id === Number(decided[1]));
      if (row === undefined || row.status !== 'requested') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Refund already decided or finished.', reason: 'NOT_DECIDABLE' }),
        });
        return;
      }
      // 🔴 假服务端**自己变**：界面那一行的新状态只能从下一次 GET 读回来。
      row.status = decided[2] === 'approve' ? 'processing' : 'rejected';
      await json(
        decided[2] === 'approve'
          ? { ok: true, outcome: 'submitted', status: 'processing', providerRefundId: '5030' }
          : { ok: true, outcome: 'decided', status: 'rejected' },
      );
      return;
    }

    if (/^\/users\/\d+$/.test(path)) {
      await json(detailBody(fake));
      return;
    }
    if (path.endsWith('/unlock')) {
      // 🔴 服务端侧真的改掉状态：界面显示的新值只能从这里读回来。
      fake.locked = false;
      fake.lockedUntil = null;
      fake.failedLogins = 0;
      await json({ ok: true, user: { id: 7, email: 'locked@example.test' } });
      return;
    }
    if (path.endsWith('/quota')) {
      const body = route.request().postDataJSON() as { quotaBytes?: number };
      if (typeof body.quotaBytes === 'number') fake.quotaBytes = body.quotaBytes;
      await json({ ok: true });
      return;
    }
    if (path.endsWith('/logout')) {
      fake.tokenVersion += 1;
      await json({ ok: true });
      return;
    }

    if (path === '/holiday-adjustments') {
      // 判据②的那份数据：一年、两条出处、两天逐日表。
      // `dayCount` 是服务端算的，界面拿它核对"存进去的 == 显示出来的"。
      await json({
        version: '1759000000000.1.2',
        years: [
          {
            year: 2026,
            papers: HOLIDAY_PAPERS,
            days: [
              { day: '2026-10-10', isOffDay: true },
              { day: '2026-10-11', isOffDay: false },
            ],
            dayCount: 2,
            updatedAt: 1_759_000_000_000,
            updatedBy: 'ops@example.test',
            note: '国务院办公厅通知',
          },
        ],
      });
      return;
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  // 🔴 `accepted` 是这套判据的前提：后台的每一格都是**从 `/api/admin/*` 读回来**的，
  // 而隐私闸门换掉的是整个 `window.fetch`。`local-only` 下那些 route 一次都不会
  // 被调用 —— 面板空着，症状长得像"后台坏了"。
  await openApp(page, '/', 'accepted');
  await openSettingsView(page);

  return { adminCalls };
}

/** 打开设置页并等探测回来。*/
async function openPanel(page: Page): Promise<void> {
  await page
    .waitForResponse((res) => res.url().startsWith(ADMIN), { timeout: 15_000 })
    .catch(() => null); // 超时不在这里判：截图之后交给下面的断言。
}

/** 概览里的一格：按**标签**找到那一格，再断言它的值。 */
function stat(page: Page, label: string) {
  return page.locator('[data-testid="admin-overview"] .ht-settings__admin-stat').filter({ hasText: label });
}

/**
 * 🔴 截图前把目标**滚进视野**。
 *
 * 设置页很长，后台排在导出/导入/AI 设置之后 —— 直接 `page.screenshot()` 拍到的是
 * 页头，那张图**证明不了面板长什么样**，而 §6.2 规定一要的恰好就是这张图。
 * （Playwright 的 `click` 会自动滚动，`screenshot` 不会 —— 这个差别很容易踩。）
 */
async function shoot(
  page: Page,
  target: Locator,
  name: string,
  /**
   * 落在哪。默认仍是 `test-results/`（既有那些用例一张都没改）。
   * 🔴 但**新落的判据要留证**就给受版本控制的那份：`e2e/test-results/` 每趟被清，
   *   一张"截图为证"的图如果只活在那里，下一趟跑完就没有人能再打开它看。
   */
  dir = 'test-results',
): Promise<void> {
  await target
    // 🔴 必须给它一个**短超时**：默认会等到整条用例超时（60s），那时页面已被关掉，
    // `screenshot` 直接报 "Target page, context or browser has been closed" ——
    // 于是"失败时也要有图"（§6.2 规定一第 1 条）在最需要它的时候失效。
    .scrollIntoViewIfNeeded({ timeout: 3_000 })
    .catch(() => null); // 目标不在时不在这儿报错，交给后面的断言。
  await page.screenshot({ path: `${dir}/${name}` });
}

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

/** 本仓库从来没有 favicon（同 `inbox.spec.ts` 与 `motivation.spec.ts` 的登记）。 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

function assertNoProblems(problems: PageProblems, expectedBad: readonly string[] = []): void {
  const unexpected = problems.badResponses.filter(
    (path) => !KNOWN_MISSING.some((known) => path === known) && !expectedBad.includes(path),
  );
  expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);
  const nonResource = problems.consoleErrors.filter(
    (text) => !/Failed to load resource/u.test(text),
  );
  expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  expect(problems.pageErrors, `不该有未捕获异常：${JSON.stringify(problems.pageErrors)}`).toEqual([]);
}

/** 后台的标签页（词条来自 `packages/i18n` 的 `web.admin.tab.*`）。 */
type AdminTabLabel = '概览' | '用户' | '订阅' | '订单' | '优惠码' | '邀请' | '调休/补班' | '退款';

/**
 * 🔴 必须**限定在面板内**：`role="tab"` 在这个应用里不止一处
 * （rail 的视图 tab、通知面板的两个 tab 都是），不限定就会命中多个元素。
 */
function adminTab(page: Page, label: AdminTabLabel) {
  return page.getByTestId('admin-panel').getByRole('tab', { name: label, exact: true });
}

/**
 * 🔴 「这一行的标识在**屏幕上**完整看得见」—— 不是「DOM 里有这段文字」。
 *
 * `toContainText` 读的是 DOM，而 CSS `text-overflow: ellipsis` 截断时**字还在 DOM 里**，
 * 于是三条断言全绿的截图上，运营其实看不见自己在批哪一笔。看图实测到的形状：
 * 带批准按钮的那一行被压成 `用户 #7719…`（`out_refund_no` 整段消失），
 * 展开二次确认时更糟 —— 整行标识挤到看不见，而那正是最要看清的一刻。
 *
 * 判据用 `scrollWidth > clientWidth`（内容比盒子宽 = 被裁），留 1 px 给亚像素舍入。
 */
async function expectRowIdentityNotClipped(list: Locator): Promise<void> {
  const rows = list.locator('li');
  const count = await rows.count();
  expect(count, '退款列表一行都没有，这条判据就成了空判').toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const main = rows.nth(index).locator('.ht-settings__admin-rowMain');
    const clipped = await main.evaluate((el) => el.scrollWidth - el.clientWidth);
    const text = await main.innerText();
    expect(clipped, `第 ${String(index + 1)} 行的标识被裁掉 ${String(clipped)} px：${text}`).toBeLessThanOrEqual(
      1,
    );
  }
}

test.describe('运营管理后台（真浏览器）', () => {
  test('概览渲染出真实数字与金额（截图为证）', async ({ page }) => {
    const problems = captureProblems(page);
    await seed({ page });
    await openPanel(page);

    // 先截图，再断言（§6.2 规定一第 1 条：失败时也要有图）。
    await shoot(page, page.getByTestId('admin-panel'), 'admin-overview.png');

    const panel = page.getByTestId('admin-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.ht-settings__h3')).toContainText('管理后台');

    // 每一个数字都只可能来自 `/api/admin/overview` 的响应体。
    await expect(page.getByTestId('admin-overview')).toBeVisible();
    await expect(stat(page, '用户总数')).toContainText('8');
    await expect(stat(page, '已验证')).toContainText('6');
    await expect(stat(page, '管理员')).toContainText('1');
    await expect(stat(page, '当前锁定')).toContainText('2');
    await expect(stat(page, '有效订阅')).toContainText('2');
    await expect(stat(page, '订单总数')).toContainText('5');
    await expect(stat(page, '已核销')).toContainText('7');
    await expect(stat(page, '已激活')).toContainText('2');
    // 金额走 `formatMoney`（最小单位 ÷ 100 + 币种），两个币种都在。
    // ⚠️ 不能用 `stat(page, '已付金额')`：那个标签**每个币种一格**，定位器会命中两个
    // 元素，Playwright 的 strict mode 会因为"匹配到 2 个"而红 —— 那与格式无关。
    const overview = page.getByTestId('admin-overview');
    await expect(overview).toContainText('39.00 CNY');
    await expect(overview).toContainText('9.90 USD');

    // 探测成功时不许出现任何失败文案（"两种失败分开说"的守卫）。
    await expect(page.getByTestId('admin-error')).toHaveCount(0);

    assertNoProblems(problems);
  });

  test('六个 Tab 各自按需拉数据；没点到的不发请求、点两下不重拉', async ({ page }) => {
    const problems = captureProblems(page);
    const { adminCalls } = await seed({ page });
    await openPanel(page);
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    // 🔴 挂载时只探测概览一次 —— 六个 Tab 的数据不该预取。
    expect(adminCalls).toEqual(['GET /overview']);

    // ⚠️ 这一支原来登记过一条**产品边界**：`/invites` 的响应里 `codes.items` 有内容，
    // 但邀请页只渲染 referrals，邀请码那一面在界面上块都不块。缺陷已修，
    // 判据在下面的"邀请码那一面"那一段 —— 它是从这条边界长出来的，不是装饰。
    const cases: readonly {
      label: AdminTabLabel;
      path: string;
      testId: string;
      rows: number;
      screenshot: string;
      expect: string;
    }[] = [
      { label: '用户', path: '/users', testId: 'admin-users', rows: 3, screenshot: 'admin-tab-users.png', expect: '共 8 人' },
      { label: '订阅', path: '/subscriptions', testId: 'admin-subscriptions', rows: 2, screenshot: 'admin-tab-subscriptions.png', expect: 'locked@example.test' },
      { label: '订单', path: '/orders', testId: 'admin-orders', rows: 3, screenshot: 'admin-tab-orders.png', expect: '9.00 USD' },
      { label: '优惠码', path: '/coupons', testId: 'admin-coupons', rows: 2, screenshot: 'admin-tab-coupons.png', expect: 'LAUNCH20' },
      { label: '邀请', path: '/invites', testId: 'admin-referrals', rows: 1, screenshot: 'admin-tab-invites.png', expect: '被邀请人: locked@example.test' },
    ];

    for (const one of cases) {
      const before = adminCalls.length;
      await adminTab(page, one.label).click();
      const list = page.getByTestId(one.testId);
      await expect(list).toBeVisible();
      // 🔴 用 `shoot` 而不是裸 `page.screenshot()`：不滚动的话拍到的是页头，
      // 那张图**证明不了这个 Tab 渲染了什么**（§6.2 规定一）。
      await shoot(page, list, one.screenshot);

      await expect(list.locator('li')).toHaveCount(one.rows);
      await expect(page.getByTestId('admin-panel')).toContainText(one.expect);
      // 每个端点**恰好一次**（按需拉取 + 不重复）。
      // 🔴 记的是 `${method} ${path}${search}`（例如 `GET /users?limit=50&offset=0`），
      // 所以判"是不是这个端点"必须**连着方法前缀一起比**。
      // 原来写成 `call.split('?')[0] === one.path` —— `split('?')[0]` 留下的是
      // `GET /users`，它永远不等于 `/users`，于是这条在任何实现下都必红。
      // （假绿和假红都是"判据不可用"，只是这一种会一直挡路。）
      // `=== `GET ${path}`` 与 `startsWith(`GET ${path}?`)` 两条并列，
      // 顺带保证不会把详情页的 `GET /users/7` 误算成列表的拉取。
      const hits = adminCalls
        .slice(before)
        .filter((call) => call === `GET ${one.path}` || call.startsWith(`GET ${one.path}?`));
      expect(hits, `${one.path} 应该被拉到且只拉到一次`).toHaveLength(1);
    }

    // ── 邀请码那一面（缺陷回归判据）─────────────────────────────────────
    // 🔴 `/invites` 一个响应带两面，原来界面只渲染 referrals。这里必须数得出
    // **邀请码**那一面 —— 只断言"面板里出现了 ABCD2345"是不够的：referrals 行里
    // 也带着同一个 `code`，所以判据必须落在具体的那个列表上。
    const codes = page.getByTestId('admin-codes');
    await shoot(page, codes, 'admin-invite-codes.png');
    await expect(codes.locator('li')).toHaveCount(1);
    await expect(codes).toContainText('ABCD2345');
    await expect(codes).toContainText('归属人: boss@example.test');
    // 一个响应两面 ⇒ 一次请求。分页器不该把 `codes` 拆成第二次拉取。
    expect(adminCalls.filter((call) => call.startsWith('GET /invites'))).toHaveLength(1);

    // 再点一次已经看过的 Tab：数据已在 store 里，不该再发请求。
    const totalBefore = adminCalls.length;
    await adminTab(page, '用户').click();
    await adminTab(page, '邀请').click();
    await adminTab(page, '用户').click();
    // 🔴 必须先等一会儿再数：不等的话"多余请求晚到"这种实现缺陷会**从断言后面溜过去**，
    // 这条判据就变成一条永远通过的判据（§7 元规则 2：那比没有判据更糟）。
    await page.waitForTimeout(400);
    expect(adminCalls.slice(totalBefore), '重复点击不该重拉').toEqual([]);

    // 用户那一面的三种徽标是各自独立的判定，必须三种同时在场。
    const badges = page.getByTestId('admin-users').locator('.ht-settings__admin-badge');
    await expect(badges).toHaveCount(3);
    await expect(badges.filter({ hasText: '管理员' })).toHaveCount(1);
    await expect(badges.filter({ hasText: '已锁定' })).toHaveCount(1);
    await expect(badges.filter({ hasText: '未验证' })).toHaveCount(1);

    assertNoProblems(problems);
  });

  test('三个动作打到各自端点，界面显示的是重新拉回来的服务端值', async ({ page }) => {
    const problems = captureProblems(page);
    const fake = defaultFake();
    const { adminCalls } = await seed({ page, fake });
    await openPanel(page);
    await adminTab(page, '用户').click();
    await expect(page.getByTestId('admin-users')).toBeVisible();

    await page
      .getByTestId('admin-users')
      .locator('button.ht-settings__admin-row')
      .filter({ hasText: 'locked@example.test' })
      .click();

    const detail = page.getByTestId('admin-user-detail');
    await expect(detail).toBeVisible();
    await shoot(page, detail, 'admin-user-detail.png');

    // 基线：这两个数字只可能来自服务端。
    await expect(detail).toContainText('失败登录: 5');
    await expect(detail).toContainText('/ 100.0 MiB');

    // ── 解锁：POST 打出去 + 重新 GET 才能看到 0 ─────────────────────────
    // 🔴 三个动作的控件都**限定在详情容器里**：设置页上还有同步设置、AI 设置等
    // 好几个面板，其中就有别的"保存"按钮 —— 不限定会点到别人身上。
    await detail.getByRole('button', { name: '解锁账号' }).click();
    await expect(page.getByTestId('admin-action-notice')).toHaveText('已完成。');
    await expect(detail).toContainText('失败登录: 0');
    expect(adminCalls).toContain('POST /users/7/unlock');
    // 动作之后必须重新拉详情（`store` 里 `reloadAfterUserAction` 的第一跳）。
    expect(adminCalls.filter((call) => call === 'GET /users/7').length).toBeGreaterThanOrEqual(2);
    // 🔴 缺陷回归判据：**列表那一行也必须跟着变**。原来 `unlockUser` 只重拉详情，
    // 于是解完锁之后列表仍挂着「已锁定」，而再点一次「用户」Tab 也不重拉
    // （那条判据正是"点两下不重拉"）—— 界面留下一条已经不成立的事实。
    // 假服务端的列表由 `fake.locked` 决定 ⇒ 徽标消失只能来自第二次列表请求。
    const lockedBadge = page
      .getByTestId('admin-users')
      .locator('.ht-settings__admin-badge', { hasText: '已锁定' });
    await expect(lockedBadge, '解锁后列表不该再显示「已锁定」').toHaveCount(0);
    expect(
      adminCalls.filter((call) => call.startsWith('GET /users?')).length,
      '动作之后必须重新拉列表',
    ).toBeGreaterThanOrEqual(2);
    await shoot(page, page.getByTestId('admin-users'), 'admin-user-unlock-list.png');

    // ── 配额：填 MiB，发出去的必须是字节；界面显示服务端存下的那个数 ────
    await detail.getByLabel('新配额（MiB）').fill('2');
    await detail.getByRole('button', { name: '保存' }).click();
    await expect(detail).toContainText('/ 2.0 MiB');
    expect(fake.quotaBytes, '服务端存的必须是 2 MiB 的字节数').toBe(2 * 1024 * 1024);

    // ── 强制登出 ────────────────────────────────────────────────────────
    await detail.getByRole('button', { name: '强制登出' }).click();
    await expect(page.getByTestId('admin-action-notice')).toHaveText('已完成。');
    expect(adminCalls).toContain('POST /users/7/logout');
    await shoot(page, detail, 'admin-user-actions.png');

    assertNoProblems(problems);
  });

  test('🔴 403 ⇒ 后台一块都不渲染（普通用户看不见多出来的东西）', async ({ page }) => {
    const problems = captureProblems(page);
    await seed({ page, overviewStatus: 403 });
    await openPanel(page);

    // 探测被拒 ⇒ 面板不渲染，而且**也不显示失败文案**（那是"没权限"，不是"出错了"）。
    await expect(page.getByTestId('admin-panel')).toHaveCount(0);
    await expect(page.getByTestId('admin-error')).toHaveCount(0);
    // ⚠️ 设置页上 `.ht-settings__h3` 本来就有好几个，所以这里必须"过滤后数个数"，
    // 不能对着一堆元素用 `not.toContainText`（那只会得到 strict mode violation）。
    await expect(page.locator('.ht-settings__h3', { hasText: '管理后台' })).toHaveCount(0);
    // 🔴 这张图要的证据是"后台**该在的那一片**是空的"。原来用 `fullPage: true`，
    // 但设置视图自己是一个滚动容器 —— `fullPage` 只扩展文档滚动区，拍不到容器内部，
    // 结果图落在页面中部，压根没拍到那一块（图存在，但它证明不了任何事）。
    // 所以锚到"紧跟在后台之后的那个区块标题"上，滚到那里再拍。
    await shoot(page, page.getByTestId('import-panel'), 'admin-forbidden.png');

    // 那条 403 是**本用例自己造的响应**，不是界面坏了 —— 但只放行这一个具体路径，
    // 按状态码放行会把将来真的坏掉的 4xx 一起藏掉。
    assertNoProblems(problems, ['/api/admin/overview']);
  });

  test('🔴 退款 Tab：投影里每一行都画出来，而只有待批准的那一行给按钮', async ({ page }) => {
    const problems = captureProblems(page);
    await seed({ page });
    await openPanel(page);
    await adminTab(page, '退款').click();

    const list = page.getByTestId('admin-refunds');
    // 先截图，再断言（§6.2 规定一第 1 条）。
    await shoot(page, list, 'admin-tab-refunds.png');

    await expect(list.locator('li')).toHaveCount(2);
    const first = list.locator('li').first();
    // 🔴 **逐字段的存在性**：少画任何一列（比如不显示 `out_refund_no`）运营就看不见那条事实，
    // 而"整块渲染了"看不出来（W5 那条教训：断言只会验界面写了什么，不会验界面少了什么）。
    for (const value of [
      '#1207',
      '3304',
      '7719',
      'HYRFDEMO0001',
      '40.12',
      'CNY',
      '30',
      'wechat',
      'requested',
    ]) {
      await expect(first).toContainText(value);
    }
    // DOM 里有 ≠ 屏上看得见：上面那九条在"被 ellipsis 截断"的画面上**全部照样绿**。
    await expectRowIdentityNotClipped(list);
    await expect(first.locator('[data-testid="admin-refund-approve-1207"]')).toBeVisible();
    // 已经走到 `success` 的那一行不再给按钮：状态机不认这一跳，点下去只会拿到一次 409。
    // ⚠️ 这**不是**安全措施（服务端才是裁决者），是不制造一次注定失败的点击。
    await expect(list.locator('[data-testid="admin-refund-approve-1206"]')).toHaveCount(0);
    assertNoProblems(problems);
  });

  test('🔴 退款：批准是两步 —— 第一次点只出确认、一个请求都不发', async ({ page }) => {
    const problems = captureProblems(page);
    const { adminCalls } = await seed({ page });
    await openPanel(page);
    await adminTab(page, '退款').click();
    await page.getByTestId('admin-refund-note-1207').fill('用户坚持，客服同意');

    await page.getByTestId('admin-refund-approve-1207').click();
    await shoot(page, page.getByTestId('admin-refund-approve-confirm'), 'admin-refund-confirm.png');
    // 这一条是钱的那道闸：一次点击就动钱、且动出去收不回来的动作不许一步做完。
    expect(adminCalls.filter((call) => call.includes('/approve')), '第一步不许发请求').toEqual([]);
    await expect(page.getByTestId('admin-refund-approve-confirm')).toContainText('收不回来');
    // 🔴 确认这一步**展开在行里**，会把行主内容挤没 —— 而"我在批哪一笔"必须看得见。
    await expectRowIdentityNotClipped(page.getByTestId('admin-refunds'));

    await page.getByTestId('admin-refund-approve-yes-1207').click();
    expect(
      adminCalls.filter((call) => call === 'POST /refunds/1207/approve'),
      '第二步才发，且只发一次',
    ).toHaveLength(1);
    // 界面上那一行来自**重新读回的 GET**：新状态是 processing，而界面不许说"已退款"
    // （`success` 只由签名有效的回调认领，ADR-0053 §4）。
    await expect(page.getByTestId('admin-refunds').locator('li').first()).toContainText('processing');
    await expect(page.getByTestId('admin-refund-notice')).toContainText('已交给支付通道');
    await expect(page.getByTestId('admin-panel')).not.toContainText('已退款');
    await shoot(page, page.getByTestId('admin-refunds'), 'admin-refund-approved.png');
    assertNoProblems(problems);
  });

  test('🔴 退款：409 的原因码要走到运营眼前（ADR-0053 §5 第 11 条）', async ({ page }) => {
    const problems = captureProblems(page);
    const { adminCalls } = await seed({ page, refundDenyReason: 'WINDOW_PASSED' });
    await openPanel(page);
    await adminTab(page, '退款').click();
    await page.getByTestId('admin-refund-order-input').fill('3304');
    await page.getByTestId('admin-refund-request-note').fill('用户来申请');
    await page.getByTestId('admin-refund-request').click();

    const notice = page.getByTestId('admin-refund-notice');
    await shoot(page, notice, 'admin-refund-denied.png');

    expect(adminCalls.filter((call) => call === 'POST /refunds')).toHaveLength(1);
    // 🔴 这一条判的是"码 → 那句话"整条链路：传输层带不带 `serverReason`、
    // store 认不认这一档、面板有没有把码映射成词条 —— 三段里断任何一段都会红。
    await expect(notice).toContainText('超出当前退款政策的时间窗');
    // 折成 5xx 那句"服务端出错了"就是把"请求没写错、是那一单的状态不允许"这条事实弄丢了。
    await expect(page.getByTestId('admin-panel')).not.toContainText('服务端出错了');
    // 被拒的申请没进列表（假服务端也没加行）—— 界面不许显示一条不存在的申请。
    await expect(page.getByTestId('admin-refunds').locator('li')).toHaveCount(2);
    assertNoProblems(problems, ['/api/admin/refunds']);
  });

  test('🔴 没登录 ⇒ 一个后台请求都不发', async ({ page }) => {
    const problems = captureProblems(page);
    const adminCalls: string[] = [];
    page.on('request', (req) => {
      if (req.url().startsWith(ADMIN)) adminCalls.push(req.url());
    });

    // 刻意**不**塞凭据：`baseUrl` 为空时客户端一个请求都不发（AGENTS §3.5 那道闸）。
    //
    // 🔴 这一条**必须**答 `accepted`，否则它是个永远通过的判据：隐私闸门在
    // `local-only` 下同样让 `adminCalls` 为空，于是"没登录不发请求"这件事
    // 到底是谁拦住的看不出来 —— 而它判的是**那道闸**，不是隐私同意。
    // 把闸门打开，唯一还能拦住请求的就只剩"没有配置"。
    await openApp(page, '/', 'accepted');
    await openSettingsView(page);
    await page.waitForTimeout(500); // 给"该发而没发"的请求一点时间冒出来

    await expect(page.getByTestId('admin-panel')).toHaveCount(0);
    await expect(page.locator('.ht-settings__h3', { hasText: '管理后台' })).toHaveCount(0);
    expect(adminCalls, `未登录时不该有任何后台请求：${JSON.stringify(adminCalls)}`).toEqual([]);
    // 同 403 那条：锚到后台该在的那一片再拍（`fullPage` 拍不进设置浮层这个滚动容器）。
    await shoot(page, page.getByTestId('import-panel'), 'admin-not-configured.png');

    assertNoProblems(problems);
  });

  /*
    🔴 **W4b 判据②的界面那一半**：出处（papers）在后台回显成可点的链接。
    jsdom 那一份（`apps/web/tests/admin-panel.spec.tsx`）钉的是"渲染成 `<a href>`"，
    这一条要的是真浏览器里的四件事：真的打了一次 `/api/admin/holiday-adjustments`、
    链接的 `href` 就是那条 URL、**链接的文字也是那条 URL**（写成"查看出处"就把
    取证链接藏进了标签里，运营者无法核对原文），以及那张图里看得见它。
    图落在受版本控制的 `apps/web/evidence/admin-holiday/`（`test-results/` 每趟被清）。
  */
  test('🔴 调休/补班那一页把出处回显成可点链接（判据②，截图为证）', async ({ page }) => {
    const problems = captureProblems(page);
    const { adminCalls } = await seed({ page });
    await openPanel(page);
    await expect(page.getByTestId('admin-panel')).toBeVisible();

    await adminTab(page, '调休/补班').click();
    const years = page.getByTestId('admin-holiday-years');
    await expect(years, '调休/补班那一页没渲染出年度列表').toBeVisible();
    await shoot(page, years, 'admin-holiday-papers.png', '../apps/web/evidence/admin-holiday');

    await expect(years.locator('li')).toHaveCount(1);
    // 按需拉取：这个端点恰好一次（与其余六个 Tab 同一条纪律）。
    expect(
      adminCalls.filter(
        (call) => call === 'GET /holiday-adjustments' || call.startsWith('GET /holiday-adjustments?'),
      ),
      '出处那一页要么没拉、要么重拉了',
    ).toHaveLength(1);

    const links = years.locator('[data-testid="admin-holiday-papers"] a');
    await expect(links).toHaveCount(HOLIDAY_PAPERS.length);
    for (const paper of HOLIDAY_PAPERS) {
      const link = links.filter({ hasText: paper });
      await expect(link, `界面上找不到那条出处：${paper}`).toHaveCount(1);
      // `href` 逐字等于那条 URL（不是被包了一层跳转页）。
      await expect(link).toHaveAttribute('href', paper);
      // 防线：新窗口打开时不许把后台这一页的 window 交出去。
      await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    }
    // 界面显示的条数 == 服务端算出的 `dayCount`（"存进去的 == 显示出来的"）。
    await expect(years).toContainText('国务院办公厅通知');

    // 🔴 这一条是**看图**加进来的，不是从需求推出来的。第一趟截图里年份显示成「2026…」：
    // 两条 gov.cn 长 URL 的出处徽标把同一行的主体挤到被省略号裁切。
    // **文本断言抓不到它** —— DOM 里文字是完整的，裁切只发生在渲染上（与 §8.4 里 W5 那条
    // "断言只验写了什么、不验少了什么"是同一族，这次是"少了看得见的部分"）。
    // 所以判据必须是几何的：这一格的滚动宽度不超过它自己的宽度 = 没有任何内容被藏起来。
    const rowMain = years.locator('li').first().locator('.ht-settings__admin-rowMain');
    await expect(rowMain, '年度那一格连年份都没有').toContainText('2026');
    const box = await rowMain.evaluate((el) => ({
      hidden: el.scrollWidth - el.clientWidth,
      width: el.clientWidth,
      text: el.textContent ?? '',
    }));
    // 🔴 正向对照：一条"元素没参与布局"的读数（`0 - 0 = 0`）会让上面那条判据**永远通过**。
    // 先证明这一格真的被排版了（宽度 > 100px：整条后台面板有 1000px 可用），
    // 才有资格说"没被裁切"。（AGENTS §7 元规则 2；这条对照是被自己的假绿逼出来的。）
    expect(box.width, `这一格根本没参与布局（clientWidth=${box.width}），"没被裁切"是空测`).toBeGreaterThan(100);
    // `1` 是亚像素舍入的容差，不是"裁掉一点没关系"：实测被挤掉时这个数是几十。
    expect(box.hidden, `年度那一格被裁掉 ${box.hidden}px ⇒ 年份在界面上看不见（文本="${box.text}"）`).toBeLessThanOrEqual(1);

    assertNoProblems(problems);
  });
});
