/**
 * 换绑邮箱 + 登录设备 + 改登录密码三块新界面的**真浏览器**验收（工单 W4/W3 那条"必须有截图"的腿）。
 *
 * 真：Chromium、IndexedDB、React 树、store、词条渲染、点击与焦点行为。
 * 假：只有账号面那几条 HTTP 的响应体（默认 e2e 的 webServer 后面没有 PostgreSQL）。
 * ⇒ 这份证据说的是"界面画出来了、点得动、说的每句话与状态一致"，
 * **不是**"服务端那条链正确" —— 那一半在
 * `server/tests/integration/email-change-and-sessions.integration.spec.ts`（真 PG，零 mock）。
 *
 * 🔴 每张状态图都在断言**之前**落盘，且落在**受版本控制**的目录：
 * `e2e/test-results/` 每趟被清，一张"截图为证"的图只活在那里的话，
 * 下一趟跑完就没人能再打开它看（AGENTS §6.2 规定一）。
 *
 * ⚠️ 这一份里没有任何真凭据（地址与令牌都是 `.test` 假值），所以不需要截图遮罩与
 * trace/video 关闭那套；那条纪律属于会带出真令牌的套件。
 */
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  closeSettingsSheet,
  openApp,
  openSettingsSheet,
  selectSettingsSection,
  stubLegalRecheck,
  stubPublicFacts,
  switchTheme,
  waitForOverlaySettled,
} from './helpers';

/** 一个**不属于**假端点（4319）的地址：这样"这条请求归谁"没有歧义。 */
const SERVER = 'http://account-suite.e2e.test';
const WS_GLOB = 'ws://account-suite.e2e.test/api/sync/ws*';
const CURRENT_EMAIL = 'light-user@example.test';
const NEW_EMAIL = 'new-inbox@example.test';
const EVIDENCE = fileURLToPath(new URL('../../apps/web/evidence/account-suite', import.meta.url));

const CURRENT_SESSION_ID = 'a'.repeat(64);
const OTHER_SESSION_ID = 'b'.repeat(64);
/** 改密成功换发的那一枚新会话（假库里"其它设备"随 bump 一起消失，与真库同形）。 */
const CHANGED_SESSION_ID = 'c'.repeat(64);
/** 假服务端那一侧的当前口令：`fx.password` 的初值。 */
const OLD_PASSWORD = 'the-old-one';
const NEW_PASSWORD = 'a-brand-new-one';

/** 界面上那几句话必须逐字对得上词条表（唯一文案事实源），对得上才敢说"分开措辞成立"。 */
const COPY = {
  emailChangeTitle: '更换登录邮箱',
  emailChangeIntro: '这次更换需要你在新旧两个邮箱里各点一次，两边都点完才会生效。',
  awaitingOld: '新邮箱那一边已经确认，还在等当前邮箱这一边。',
  awaitingNew: '当前邮箱那一边已经确认，还在等新邮箱这一边。',
  sessionsTitle: '登录设备',
  revokeOne: '退出这一台',
  logoutAll: '退出所有设备',
  passwordTitle: '登录密码',
  passwordChanged: '登录密码已修改。',
  // 🔴 这句是**后果**不是失败信息：它必须在点之前就在界面上（少一整段说明是抓不到的）。
  passwordOtherDevices:
    '其它设备上的登录都会失效，要用新密码重新登录；数据不受影响。这个标签页会自动接着用新密码。',
  passwordWrongCurrent: '登录失败：邮箱或密码不正确。',
} as const;

type Fixture = {
  /** 换绑请求的状态机：`null` = 没有活请求。 */
  change: { pendingEmail: string; awaitingOld: boolean; awaitingNew: boolean } | null;
  /** 会话表：撤销就是从里面对掉那一行（与真库"存在即有效"同形）。 */
  sessions: Array<{
    sessionId: string;
    current: boolean;
    createdAt: number;
    lastSeenAt: number;
    userAgent: string | null;
  }>;
  /** 界面真的打出来的每一条（`方法 路径`）。 */
  requests: string[];
  /** 假服务端那一侧"当前"的口令：改密成功就换掉，与真库那次 `passwordHash` 写回同形。 */
  password: string;
  /** 改密之后库里剩下的是哪一枚会话（bump 把其它行整个作废 ⇒ 只剩新铸那枚）。 */
  sessionAfterChange: string | null;
};

const newFixture = (): Fixture => ({
  change: null,
  sessions: [
    {
      sessionId: CURRENT_SESSION_ID,
      current: true,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140',
    },
    {
      sessionId: OTHER_SESSION_ID,
      current: false,
      createdAt: Date.now() - 3_600_000,
      lastSeenAt: Date.now() - 60_000,
      userAgent: 'Mozilla/5.0 (iPhone) Safari/605',
    },
  ],
  requests: [],
  password: OLD_PASSWORD,
  sessionAfterChange: null,
});

async function json(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/**
 * 账号面这几条做成一台**状态机**，其余一律回 500 并记进 `requests`。
 *
 * 🔴 500 不是偷懒：本套件每条用例结尾都挂着 `assertNoProblems`，
 * 所以"界面偷偷多打了一条路由"或"打错了一条"都会变成一条能读的失败，
 * 而不是一片对任何请求都回 200 的假绿。
 */
async function installAccountRoutes(page: Page, fx: Fixture): Promise<void> {
  await page.route(`${SERVER}/**`, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname.replace(/^\/api/, '');
    fx.requests.push(`${method} ${path}`);

    if (method === 'GET' && path === '/account/email/change/status') {
      const change = fx.change;
      return json(
        route,
        change === null
          ? { pending: false, awaitingOld: false, awaitingNew: false }
          : {
              pending: true,
              awaitingOld: change.awaitingOld,
              awaitingNew: change.awaitingNew,
              pendingEmail: change.pendingEmail,
              expiresAt: Date.now() + 24 * 60 * 60 * 1000,
              resendAvailableAt: Date.now(),
            },
      );
    }
    if (method === 'POST' && path === '/account/email/change/request') {
      const body = route.request().postDataJSON() as { newEmail?: string };
      fx.change = { pendingEmail: String(body.newEmail), awaitingOld: true, awaitingNew: true };
      return json(route, {
        message: '两封信已经发出，请在新旧两个邮箱里各点一次。',
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        resendAvailableAt: Date.now() + 60_000,
      });
    }
    if (method === 'POST' && path === '/account/email/change/cancel') {
      fx.change = null;
      return json(route, { message: '这次更换已经取消，邮箱地址没有改动。' });
    }
    if (method === 'GET' && path === '/auth/sessions') {
      return json(route, {
        sessions: fx.sessions.map((s) => ({
          sessionId: s.sessionId,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          deviceName: null,
          userAgent: s.userAgent,
          current: s.current,
        })),
      });
    }
    const revoke = /^\/auth\/sessions\/([0-9a-f]{64})$/.exec(path);
    if (method === 'DELETE' && revoke !== null) {
      const before = fx.sessions.length;
      fx.sessions = fx.sessions.filter((s) => s.sessionId !== revoke[1]);
      return json(route, { success: fx.sessions.length < before });
    }
    if (method === 'POST' && path === '/auth/sessions/revoke-all') {
      const count = fx.sessions.length;
      fx.sessions = [];
      return json(route, { success: true, count });
    }
    if (method === 'POST' && path === '/auth/logout') {
      fx.sessions = fx.sessions.filter((s) => !s.current);
      return json(route, { message: 'Signed out.' });
    }
    if (method === 'POST' && path === '/password/change') {
      const body = route.request().postDataJSON() as {
        currentPassword?: string;
        newPassword?: string;
      };
      if (String(body.currentPassword) !== fx.password) {
        // 与真服务端同形：401 + `invalid_credentials`（`hosted-auth.ts:644` 把它映射成
        // `invalid-credentials`，面板据此把焦点落回**当前密码**那个框）。
        return json(route, { error: 'Invalid credentials.', code: 'invalid_credentials' }, 401);
      }
      fx.password = String(body.newPassword);
      // 🔴 bump 之后**只有新铸那一枚**还在（真库里 `listSessions` 按 `tokenVersion` 过滤），
      // 而手上这台换成了新令牌 ⇒ 列表自己重拉之后应当只剩这一行。
      fx.sessionAfterChange = CHANGED_SESSION_ID;
      fx.sessions = [
        {
          sessionId: CHANGED_SESSION_ID,
          current: true,
          createdAt: Date.now(),
          lastSeenAt: Date.now(),
          userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140',
        },
      ];
      return json(route, {
        token: 'account-suite-e2e-token-changed',
        user: { id: 7, email: CURRENT_EMAIL },
      });
    }
    return json(route, { unexpected: `${method} ${path}` }, 500);
  });
}

/**
 * 塞了凭据之后**一开机就会发**的那几条：与账号面无关，但漏一条就会有一声 500
 * 混进 `assertNoProblems`，把真正的失败淹掉（`inbox.spec.ts` / `admin-console.spec.ts`
 * 记过同一件事，理由不重复写）。
 */
async function stubUnrelatedStartupCalls(page: Page): Promise<void> {
  await stubLegalRecheck(page, SERVER);
  await stubPublicFacts(page, SERVER);
  await page.route(`${SERVER}/api/sync/status**`, async (route) => {
    await json(route, { latestSeq: 0 });
  });
  await page.route(`${SERVER}/api/notifications**`, async (route) => {
    await json(route, { notifications: [], unreadCount: 0 });
  });
  await page.route(`${SERVER}/api/activity**`, async (route) => {
    await json(route, { campaigns: [] });
  });
  // 「账号」那一组里 PasskeyPanel 一挂载就列表，本套件打开的正是那一组。
  await page.route(`${SERVER}/api/passkeys**`, async (route) => {
    await json(route, { passkeys: [] });
  });
  // 自己的资料（昵称/头像哈希）：开机就拉一次，与账号面这块面板无关。
  // 形状抄 `packages/shared-schema/src/account-profile-contract.ts:286` 的
  // `accountProfileResponseSchema`（少一个字段客户端就整条判 `malformed-response`）。
  await page.route(`${SERVER}/api/account/profile**`, async (route) => {
    await json(route, { displayName: null, avatarHash: null });
  });
  // 入站自动化那两条：塞了凭据就会拉（那是**别人那条线**的面板），
  // 空但合法的形状来自 `packages/app-host/src/inbound-rules-remote.ts:143-146`
  // 与 `:131-134`（`{ rules: [] }` / `{ events: [] }`，两者都要求是数组）。
  await page.route(`${SERVER}/api/automation/rules**`, async (route) => {
    await json(route, { rules: [] });
  });
  await page.route(`${SERVER}/api/automation/events**`, async (route) => {
    await json(route, { events: [] });
  });
  // 2026-10-25 补两条**开机就会打**的请求。它们与账号面无关，但没装夹具就回非 2xx，
  // 而 `assertNoProblems` 会把它们算成"不该有的失败" ⇒ 整套 7 条用例红在一个别人的接口上。
  //   · `/api/auth/central/config` —— 中央认证入口的可用性探测（`announcement-banner` 里同一个形状）；
  //   · `/api/announcements/active` —— 运营公告（`{ announcements: [] }` 是客户端契约里的合法空集，
  //     见 `packages/app-host/src/announcement-client.ts:76-80`）。
  // ⚠️ 别改成往 `KNOWN_MISSING` 里塞：那条会替**所有**用例消掉这两格，
  //    以后它们真坏了也不会有任何一条用例说话。
  await page.route(`${SERVER}/api/auth/central/config**`, async (route) => {
    await json(route, {});
  });
  await page.route(`${SERVER}/api/announcements/active**`, async (route) => {
    await json(route, { announcements: [] });
  });
  /*
   * 🔴 `GET /api/sync/payload-mode` 是 ADR-0080 之后**应用一启动就会发**的读（载荷模式）。
   * 这个夹具的规矩是"没登记的请求算意外"，所以新端点必须在这里登记 ——
   * 与本文件里 `/api/announcements/active` 那几条同一条纪律。
   * 回 `readable`（明文账号）而不是 `e2ee`：`e2ee` 会让 vault 面板去探 key-package，
   * 而本用例的主题不是加密，不该把那一路请求带进来。
   */
  await page.route(`${SERVER}/api/sync/payload-mode**`, async (route) => {
    await json(route, { mode: 'readable' });
  });
  await page.routeWebSocket(WS_GLOB, () => {
    // 保持连接打开即可：本用例不验实时同步。
  });
}

async function seedSignedIn(page: Page): Promise<void> {
  // ⚠️ 必须在应用脚本执行**之前**写进 localStorage ⇒ 只有 `addInitScript` 是这个时机。
  await page.addInitScript(
    ({ server, email }) => {
      localStorage.setItem(
        'heyta.sync.credentials',
        JSON.stringify({ baseUrl: server, token: 'account-suite-e2e-token', email }),
      );
    },
    { server: SERVER, email: CURRENT_EMAIL },
  );
}

/**
 * 截图前先把它滚进视口（设置页很长，`SessionsPanel` 排在续费/通行密钥/改口令之后），
 * 并给**短**超时：默认会等到整条用例超时，那时页面已关掉，`screenshot` 报
 * "Target page ... has been closed" —— "失败时也要有图"就在最需要它的时候失效。
 */
async function shot(page: Page, target: Locator, name: string): Promise<void> {
  await target.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => null);
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
}

type PageProblems = {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly badResponses: string[];
};

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

/** 本仓库从来没有 favicon（同 `inbox.spec.ts` 的登记）。 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

function assertNoProblems(problems: PageProblems, expectedBad: readonly string[] = []): void {
  const unexpected = problems.badResponses.filter(
    (path) => !KNOWN_MISSING.some((known) => path === known) && !expectedBad.includes(path),
  );
  expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);
  const nonResource = problems.consoleErrors.filter(
    (text) => !/Failed to load resource/u.test(text) && !/WebSocket/u.test(text),
  );
  expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  expect(problems.pageErrors, `不该有未捕获异常：${JSON.stringify(problems.pageErrors)}`).toEqual(
    [],
  );
}

/** 统一的起跑：假路由 → 补无关的开机请求 → 塞凭据 → 真应用起来 → 开设置。 */
async function boot(page: Page, fx: Fixture): Promise<void> {
  // ⚠️ 注册顺序就是优先级（后注册的**遮蔽**先注册的）：宽泛的 `/ **` 必须先装，
  // 那几条精确的补位路由才有机会命中。
  await installAccountRoutes(page, fx);
  await stubUnrelatedStartupCalls(page);
  await seedSignedIn(page);
  await openApp(page, '/', 'accepted');
  await openSettingsSheet(page);
}

test.beforeAll(async () => {
  await mkdir(EVIDENCE, { recursive: true });
});

test('换绑邮箱：后果写在点之前、发起后状态区说"还等哪一边"、撤销回到表单', async ({ page }) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  await selectSettingsSection(page, 'profile');

  const panel = page.getByTestId('email-change-panel');
  await expect(panel, '登录着的人必须能看到「更换登录邮箱」这一块').toBeVisible();
  await expect(panel.getByText(COPY.emailChangeTitle)).toBeVisible();

  // 🔴 判据还是**存在性**，但载体变了（2026-10-25 改判）：
  //    产品负责人 2026-10-24 的禁令是"设置界面禁止内联说明文字，只允许『?』气泡"
  //    （`scripts/check-settings-no-prose.mjs` 是它的执行者）。所以那句后果说明现在在
  //    标题旁那枚「?」里，而不是占一整行。
  //    ⇒ 三条一起判，缺一条都不算：
  //      ① 那枚「?」在（不是被删掉）；
  //      ② 它的文案逐字等于那条后果句（不是被改写成"更客气"的一句）；
  //      ③ 聚焦就能展开 —— 只挂悬停的话键盘用户拿不到，而这是点下去之前唯一一次说明。
  const emailConsequence = panel.getByTestId('tip-email-change');
  await expect(
    emailConsequence,
    '后果说明必须有合法载体（标题旁的问号），而不是被删掉',
  ).toHaveText(COPY.emailChangeIntro);
  await panel.getByTestId('tip-email-change-trigger').focus();
  await expect(emailConsequence, '键盘聚焦必须能展开它').toBeVisible();

  await shot(page, panel, '01-before-request');
  await expect(page.getByTestId('email-change-form')).toBeVisible();

  await page.getByTestId('email-change-new').fill(NEW_EMAIL);
  await page.getByTestId('email-change-submit').click();

  await expect(page.getByTestId('email-change-pending')).toBeVisible();
  await shot(page, panel, '02-requested-waiting-both');
  // 两封都在路上 ⇒ 状态区说"还在等两个邮箱各点一次"，并回显那个新地址。
  await expect(page.getByTestId('email-change-stage')).toContainText('两个邮箱');
  await expect(page.getByTestId('email-change-pending-email')).toContainText(NEW_EMAIL);

  // 🔴 界面**不许替人点邮件**：这一侧点完"发起"之后，除了 status/request 两条，
  // 不许出现任何走向 confirm 的请求（那个出口是服务端那张凭据页，不在这里）。
  expect(
    fx.requests.filter((entry) => entry.includes('confirm')),
    '换绑的确认只能由收件人点开邮件完成，界面里不许有这条',
  ).toEqual([]);

  await page.getByTestId('email-change-cancel').click();
  await expect(page.getByTestId('email-change-form')).toBeVisible();
  await shot(page, panel, '03-after-cancel');
  expect(fx.change, '取消必须真的打到那条路由上').toBeNull();

  await closeSettingsSheet(page);
  assertNoProblems(problems);
});

test('换绑只等当前邮箱那一边 ⇒ 界面说的那句必须是"还在等当前邮箱这一边"', async ({ page }) => {
  // 🔴 这一条的存在理由是：`awaitingOld` / `awaitingNew` 两个布尔在界面上落到**两句不同的话**。
  // 只测"发起后有个状态区"的话，把两句话写反、或永远只印一句，都不会红。
  const problems = captureProblems(page);
  const fx = newFixture();
  fx.change = { pendingEmail: NEW_EMAIL, awaitingOld: true, awaitingNew: false };
  await boot(page, fx);
  await selectSettingsSection(page, 'profile');

  const stage = page.getByTestId('email-change-stage');
  await expect(stage).toContainText(COPY.awaitingOld);
  await shot(page, page.getByTestId('email-change-panel'), '04-waiting-old-side');
  // 反向对照：那一句"等新邮箱"不许同时出现（两句同时印出来=界面在猜）。
  await expect(stage).not.toContainText(COPY.awaitingNew);

  await closeSettingsSheet(page);
  assertNoProblems(problems);
});

test('登录设备：列两行、只一行是"这台"、退出另一台后它消失而这台仍在', async ({ page }) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  await selectSettingsSection(page, 'account');

  const panel = page.getByTestId('sessions-panel');
  await expect(panel.getByText(COPY.sessionsTitle)).toBeVisible();
  await expect(page.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeVisible();
  await expect(page.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeVisible();
  await shot(page, panel, '05-sessions-two-rows');

  // 🔴 「这台设备」这个标记只许出现一次，而且必须落在服务端自己验出的那一枚上。
  await expect(page.getByTestId(`session-current-${CURRENT_SESSION_ID}`)).toHaveCount(1);
  await expect(page.getByTestId(`session-current-${OTHER_SESSION_ID}`)).toHaveCount(0);

  // 🔴 两个动作分开措辞这一条钉在**界面**上：同一张面板里必须同时读得到
  // 「退出这一台」与「退出所有设备」，缺一句就是拿"退出登录"糊两件事。
  await expect(panel.getByRole('button', { name: COPY.revokeOne })).not.toHaveCount(0);
  await expect(panel.getByRole('button', { name: COPY.logoutAll })).toHaveCount(1);
  // 当前这一枚**按不动**：它的出口是页眉那个「退出登录」（撤销 + 清本机凭据两件事一起做），
  // 而这张列表只会撤令牌、不清本机凭据 —— 留着按下去会得到一个"本地还带着死令牌"的状态。
  // 所以这一行的按钮必须**禁用**，并且旁边那句提示要说清出口在哪。
  await expect(page.getByTestId(`session-revoke-${CURRENT_SESSION_ID}`)).toBeDisabled();
  await expect(
    page.getByTestId(`session-hint-${CURRENT_SESSION_ID}`),
    '当前那一行必须有一句"退出请用「退出登录」"，不然禁用按钮没有解释',
  ).toBeVisible();
  await expect(page.getByTestId(`session-revoke-${OTHER_SESSION_ID}`)).toBeEnabled();

  await page.getByTestId(`session-revoke-${OTHER_SESSION_ID}`).click();
  await expect(page.getByTestId('sessions-revoked')).toBeVisible();
  await shot(page, panel, '06-after-revoking-other');

  // 消失的是那一行，还留着的是这台。
  await expect(page.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeVisible();
  expect(fx.sessions.map((s) => s.sessionId)).toEqual([CURRENT_SESSION_ID]);
  expect(
    fx.requests.filter((entry) => entry.startsWith('DELETE')),
    '只许对那一枚发一次 DELETE',
  ).toEqual([`DELETE /auth/sessions/${OTHER_SESSION_ID}`]);

  await closeSettingsSheet(page);
  assertNoProblems(problems);
});

test('🔴 反证：服务端读不出来的那一格不许被画成"一切正常"（status 500 ⇒ 界面说"没读到"）', async ({
  page,
}) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  // 覆盖必须**后注册**才压得住那条宽泛的 `/ **`。
  await page.route(`${SERVER}/api/account/email/change/status`, async (route) => {
    await json(route, { error: 'boom' }, 500);
  });
  await selectSettingsSection(page, 'profile');

  await expect(
    page.getByTestId('email-change-load-failed'),
    '读失败被当成"没有待办"就是界面在说谎',
  ).toBeVisible();
  // 读不出来时**不许编出一个"还等哪一边"**：那句只能来自服务端真的答过。
  await expect(page.getByTestId('email-change-stage')).toHaveCount(0);
  await shot(page, page.getByTestId('email-change-panel'), '07-status-load-failed');

  await closeSettingsSheet(page);
  assertNoProblems(problems, ['/api/account/email/change/status']);
});

test('🔴 改登录密码：后果句在点之前、成功后那句、两个框清空、设备列表自己只剩这台', async ({
  page,
}) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  await selectSettingsSection(page, 'account');

  const panel = page.getByTestId('password-panel');
  // 截图先落盘（§6.2 规定一第 1 条：失败时也要有图）。
  await shot(page, panel, '08-password-before-submit');

  // 🔴 标题按**那个 h2 容器**判，不用 `getByRole('heading', {exact})`：
  // 2026-10-24 起标题里嵌了一枚「?」按钮（禁令要求说明进气泡），标题的可及名字因此
  // 从"登录密码"变成"登录密码 + 那枚按钮的名字"，精确匹配会抓空 —— 而抓空的原因
  // 与"标题没了"长得一样。用容器 + `toContainText` 把这两件事分开。
  await expect(panel.locator('h2.ht-settings__title')).toContainText(COPY.passwordTitle);

  // 🔴 后果句的判据同换绑那条：载体是按钮旁的「?」（`tip-password-consequence`），
  // 所以判"文案逐字在 + 聚焦能展开"，而不是"占一整行"。这条句子是让人决定要不要点的东西，
  // 只断言"点了以后出现什么"抓不到"少了一整段后果说明"。
  const consequence = panel.getByTestId('tip-password-consequence');
  await expect(consequence, '后果句必须有合法载体，而不是被删掉').toHaveText(
    COPY.passwordOtherDevices,
  );
  await panel.getByTestId('tip-password-consequence-trigger').focus();
  await expect(consequence, '键盘聚焦必须能展开它').toBeVisible();

  await page.getByTestId('password-current').fill(OLD_PASSWORD);
  await page.getByTestId('password-new').fill(NEW_PASSWORD);
  await page.getByTestId('password-submit').click();

  await expect(page.getByTestId('password-changed')).toBeVisible();
  await shot(page, panel, '09-password-changed');
  expect(fx.password, '假服务端那一侧的口令必须真的被换掉').toBe(NEW_PASSWORD);
  // 🔴 两个草稿都要清空：改完之后"当前密码"已经是旧的那句，留着只会让人拿它再提交一次。
  await expect(page.getByTestId('password-current')).toHaveValue('');
  await expect(page.getByTestId('password-new')).toHaveValue('');

  // 同一次改密换了令牌 ⇒ `SessionsPanel` 的取数键（baseUrl/token）变了，列表自己重拉。
  // 这一条钉的是**两块面板不许各说一套**：改密之后还列着那台已被踢下线的设备，
  // 就是界面在拿"它还登录着"骗人。
  await expect(page.getByTestId(`session-row-${CHANGED_SESSION_ID}`)).toBeVisible();
  await expect(page.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toHaveCount(0);
  await expect(page.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toHaveCount(0);
  expect(
    fx.requests.filter((entry) => entry.startsWith('POST /password/change')),
    '改密只许打一次那条路由',
  ).toHaveLength(1);

  await closeSettingsSheet(page);
  // 🔴 只有这一条用例要登记这一格：改密成功的**定义**就是换发新令牌，而入站自动化的
  // 收件密钥是按令牌取的（`packages/app-host/src/inbound-recipient-remote.ts:35`），
  // 令牌一变应用就重新去取 —— 本套件没给它装夹具，于是回 404。
  // 它不属于账号面，也不影响本节任何一条判据，所以按"已登记的无关路由"处理，
  // 而不是把它塞进 `KNOWN_MISSING`（那条会替**所有**用例消掉这一格，
  // 别的用例里它出现就是真信号）。
  //
  // 🔴 2026-10-25 加第二格 `/api/sync/key-package`：改密换发令牌之后，同步层会用新令牌
  // 重取一次密钥包，而这个套件的假服务端没有这一路 ⇒ 404。
  // 这一格**不是**"缺失"而是**合法空态**：`packages/app-host/src/vault-session.ts:240`
  // 明确把 404 读成"还没有密钥包"（`if (response.status === 404) return undefined;`）。
  // 所以它也不进 `KNOWN_MISSING` —— 别处真出现非 404 的失败时，那条判据还得能响。
  assertNoProblems(problems, ['/api/automation/recipient-key', '/api/sync/key-package']);
});

test('🔴 当前密码打错：不许冒一句"已修改"，焦点落回当前密码那个框', async ({ page }) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  await selectSettingsSection(page, 'account');

  await page.getByTestId('password-current').fill('not-the-current-one');
  await page.getByTestId('password-new').fill(NEW_PASSWORD);
  await page.getByTestId('password-submit').click();

  const failed = page.getByTestId('password-failed');
  await expect(failed).toBeVisible();
  await expect(failed).toContainText(COPY.passwordWrongCurrent);
  await shot(page, page.getByTestId('password-panel'), '10-password-wrong-current');
  // 🔴 失败不许被画成成功：这两个 testid 同时存在就是界面在说谎。
  await expect(page.getByTestId('password-changed')).toHaveCount(0);
  // 焦点判据：`invalid-credentials` 在这张表上指的是**当前密码**打错（不是"你没登录"），
  // 所以焦点必须落回那一个框。挂在冒泡阶段的全局键盘监听挡不住它，但 jsdom 里看不见真焦点环。
  await expect(page.getByTestId('password-current')).toBeFocused();
  expect(fx.password, '口令错那一次不许把库里的口令换掉').toBe(OLD_PASSWORD);
  expect(fx.sessions, '失败那一次也不许把设备列表改掉').toHaveLength(2);

  await closeSettingsSheet(page);
  // 401 是本用例**故意**造的（服务端拒绝一次改密），单独登记进预期。
  assertNoProblems(problems, ['/api/password/change']);
});

test('🔴 反证：改密那条路由 500 时不许画成"已修改"（读失败 ≠ 做完了）', async ({ page }) => {
  const problems = captureProblems(page);
  const fx = newFixture();
  await boot(page, fx);
  // 覆盖必须**后注册**才压得住那条宽泛的 `/ **`。
  await page.route(`${SERVER}/api/password/change`, async (route) => {
    fx.requests.push('POST /password/change (stub 500)');
    await json(route, { error: 'boom' }, 500);
  });
  await selectSettingsSection(page, 'account');

  await page.getByTestId('password-current').fill(OLD_PASSWORD);
  await page.getByTestId('password-new').fill(NEW_PASSWORD);
  await page.getByTestId('password-submit').click();

  await expect(page.getByTestId('password-failed')).toBeVisible();
  await expect(page.getByTestId('password-changed')).toHaveCount(0);
  await shot(page, page.getByTestId('password-panel'), '11-password-route-500');

  await closeSettingsSheet(page);
  assertNoProblems(problems, ['/api/password/change']);
});

/*
  暗色两档的常驻看图腿（治理计划 G-4 收尾，2026-11-04）。

  为什么这一条存在：本批把头像 / 昵称 / 邮箱三格迁进共享契约，而看图腿此前只覆盖
  **亮色**（`docs/plans/settings-ui-governance-2026-11.md` 四象限那行写着"暗色两档 = 没做像素级看图"）。
  暗色此前本线的现量只有"没有新增颜色字面量"—— 那是**间接**证据，不等于"暗色下画得出来"。

  🔴 它不只是拍图，两条能判红的断言：
    · 暗色下文字必须**比底亮**（文字与底同色是暗色最容易出的事故，而它不会让任何一条亮色判据变红）；
    · 三格行容器必须**同一个左缘与同一个宽度**，且整行不许超出面板右缘（窄档溢出就是这么露出来的）。
  ⚠️ 图与亮色那十一张同目录、同纪律（受版本控制，`e2e/test-results/` 里不留东西）。
*/

type Swatch = { readonly color: string; readonly bg: string };

/** `rgb()/rgba()` → 相对亮度（WCAG 那条线性化）。取不到就返回 -1，让断言自己红。 */
function luminOf(cssColor: string): number {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/u.exec(cssColor);
  if (m === null) return -1;
  const channel = (raw: string): number => {
    const s = Number(raw) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  // 半透明底先按"贴在纯白上"折算，再判亮度：暗色主题里带 alpha 的面板不该被读成"很暗"。
  const mix = (s: number): number => s * alpha + 255 * (1 - alpha);
  const [r, g, b] = [m[1]!, m[2]!, m[3]!].map((raw) => channel(String(mix(Number(raw)))));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

test('暗色两档看图腿：迁进共享契约的三格在 1440 与 375 的暗色下画得出来、文字比底亮', async ({
  page,
}) => {
  const problems = captureProblems(page);
  const fx = newFixture();

  const measure = async (): Promise<{
    readonly rows: Array<{ readonly x: number; readonly width: number }>;
    readonly swatch: Swatch;
    readonly overflow: Array<{ readonly id: string; readonly over: number }>;
  }> =>
    page.evaluate(() => {
      const ids = ['profile-avatar-row', 'profile-nickname-row', 'profile-email-row'];
      const panel = document.querySelector<HTMLElement>('[data-testid="profile-panel"]');
      const rows = ids.map((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`));
      // 底的亮度：从文字所在行往上找**第一层不透明**的背景，找不到就用 `html` 的。
      let node: HTMLElement | null = rows[2] ?? panel;
      let bg = 'rgba(0, 0, 0, 0)';
      while (node !== null) {
        const c = getComputedStyle(node).backgroundColor;
        if (!/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/u.test(c)) {
          bg = c;
          break;
        }
        node = node.parentElement;
      }
      const value = document.querySelector<HTMLElement>('[data-testid="profile-email"]');
      const sheet = document.querySelector<HTMLElement>('[data-testid="settings-sheet"]') ?? document.body;
      const sheetBox = sheet.getBoundingClientRect();
      const overflow = rows
        .map((row, i) => ({
          id: ids[i]!,
          over: row === null ? 0 : row.getBoundingClientRect().right - sheetBox.right,
        }))
        .filter((entry) => entry.over > 1);
      return {
        rows: rows.map((row) => {
          const box = row?.getBoundingClientRect();
          return { x: box?.left ?? -1, width: box?.width ?? -1 };
        }),
        swatch: { color: value === null ? 'rgb(0, 0, 0)' : getComputedStyle(value).color, bg },
        overflow,
      };
    });

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    if (width === 1440) {
      await boot(page, fx);
      await closeSettingsSheet(page);
      await switchTheme(page, 'dark');
    }
    await openSettingsSheet(page);
    await waitForOverlaySettled(page, 'settings-sheet');
    await selectSettingsSection(page, 'profile');

    const panel = page.getByTestId('profile-panel');
    await expect(panel, '暗色下这三格必须**存在**（不存在会被下面那条 unique 断言掩盖）').toHaveCount(1);
    for (const id of ['profile-avatar-row', 'profile-nickname-row', 'profile-email-row']) {
      await expect(page.getByTestId(id), `暗色窄档少了 ${id}`).toBeVisible();
    }
    const m = await measure();
    // 🔴 三格同一左缘、同一宽度 —— 这正是本批要消掉的那件事，暗色/窄档不许把它换回来。
    const lefts = new Set(m.rows.map((r) => Math.round(r.x)));
    expect(lefts.size, `三格行容器左缘不唯一：${JSON.stringify(m.rows)}`).toBe(1);
    const widths = new Set(m.rows.map((r) => Math.round(r.width)));
    expect(widths.size, `三格行容器宽度不唯一：${JSON.stringify(m.rows)}`).toBe(1);
    expect(m.overflow, '有行超出浮层右缘（窄档溢出）').toEqual([]);
    // 暗色最典型的事故：文字与底同色。亮色判据抓不到它，所以这一句必须在这里判。
    const textLum = luminOf(m.swatch.color);
    const bgLum = luminOf(m.swatch.bg);
    expect(textLum, `读不到文字颜色：${m.swatch.color}`).toBeGreaterThanOrEqual(0);
    expect(bgLum, `读到底色：${m.swatch.bg}`).toBeGreaterThanOrEqual(0);
    expect(
      textLum - bgLum,
      `暗色下文字不比底亮：color=${m.swatch.color} bg=${m.swatch.bg}`,
    ).toBeGreaterThan(0.1);
    await shot(page, panel, width === 1440 ? '12-profile-dark-1440' : '14-profile-dark-375');

    await selectSettingsSection(page, 'account');
    const sessions = page.getByTestId('sessions-panel');
    await expect(sessions).toBeVisible();
    await shot(page, sessions, width === 1440 ? '13-sessions-dark-1440' : '15-sessions-dark-375');

    /*
      🔴 两条**只有看图才会想到要量**的几何断言 —— 它们都是这一趟看图时抓到的形状，
      不是先写规则再找证据：
      · 注销账号那张卡里的确认复选框原来被套进 `.ht-settings__row`（两列网格，第一列
        `minmax(5rem, 8rem)`），现量 1440 档复选框的盒子宽 **121px**、375 档 **270px**，
        它要确认的那句话在第二列 —— 控件与标签隔了一整列宽。已改成 inline 流，这里钉住"相邻"。
      · 换绑邮箱那一格在 375 档输入框与「发起更换」按钮**不许互相压住**（现量 1440 间隔 8px、
        375 间隔 8px；placeholder 被输入框自己截断是正常的，压住才是事故）。
    */
    const ack = await page.evaluate(() => {
      const box = document.querySelector<HTMLInputElement>('#close-account-ack');
      if (box === null) return null;
      let textX: number | null = null;
      box.closest('label')?.childNodes.forEach((node) => {
        if (node.nodeType === 3 && (node.textContent ?? '').trim() !== '') {
          const range = document.createRange();
          range.selectNodeContents(node);
          const x = range.getBoundingClientRect().x;
          if (textX === null || x < textX) textX = x;
        }
      });
      const b = box.getBoundingClientRect();
      return { width: Math.round(b.width), gap: textX === null ? null : Math.round(textX - b.right) };
    });
    expect(ack, '注销账号的确认复选框找不到').not.toBeNull();
    /*
      🔴 两把尺子，缺一把都会漏：
      · **盒子宽度**：原生复选框是固有尺寸的小方块。盒子被拉开（实测套进两列网格时是 121px，
        375 档单列时 270px）就说明它被放进了**给文字用**的那一列 —— 屏幕上看到的是
        "小方块孤零零在左边，句子在很远的右边"。
      · **与正文的距离**：盒子右缘到那句话第一个字。
      为什么不能只量距离：盒子被撑满整列时，右缘恰好贴着下一列，距离只有 19px（变异臂实测到的数），
      看着像"挨着"，而真正的小方块离正文一百多像素。**只量距离会把这一族缺陷读成绿。**
    */
    expect(ack!.width, `确认复选框的盒子被拉到 ${ack!.width}px（原生复选框不该被拉伸）`).toBeLessThanOrEqual(24);
    expect(ack!.gap, '确认复选框与它那句话之间找不到文字').not.toBeNull();
    expect(ack!.gap!, `确认复选框与它的标签隔了 ${ack!.gap}px（>16 就是不挨着）`).toBeLessThanOrEqual(16);

    const fieldOverlap = await page.evaluate(() => {
      const input = document.querySelector<HTMLElement>('[data-testid="email-change-new"]');
      const button = document.querySelector<HTMLElement>('[data-testid="email-change-submit"]');
      if (input === null || button === null) return null;
      return Math.round(input.getBoundingClientRect().right - button.getBoundingClientRect().left);
    });
    expect(fieldOverlap, '换绑邮箱的输入框压到了「发起更换」按钮').not.toBeNull();
    expect(fieldOverlap, `输入框右缘越过按钮左缘 ${fieldOverlap}px`).toBeLessThanOrEqual(0);

    await closeSettingsSheet(page);
  }

  assertNoProblems(problems);
});
