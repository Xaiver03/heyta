/**
 * 换绑邮箱 + 登录设备两块新界面的**真浏览器**验收（工单 W4/W3 的那条"必须有截图"的腿）。
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
} from './helpers';

/** 一个**不属于**假端点（4319）的地址：这样"这条请求归谁"没有歧义。 */
const SERVER = 'http://account-suite.e2e.test';
const WS_GLOB = 'ws://account-suite.e2e.test/api/sync/ws*';
const CURRENT_EMAIL = 'light-user@example.test';
const NEW_EMAIL = 'new-inbox@example.test';
const EVIDENCE = fileURLToPath(new URL('../../apps/web/evidence/account-suite', import.meta.url));

const CURRENT_SESSION_ID = 'a'.repeat(64);
const OTHER_SESSION_ID = 'b'.repeat(64);

/** 界面上那几句话必须逐字对得上词条表（唯一文案事实源），对得上才敢说"分开措辞成立"。 */
const COPY = {
  emailChangeTitle: '更换登录邮箱',
  emailChangeIntro: '这次更换需要你在新旧两个邮箱里各点一次，两边都点完才会生效。',
  awaitingOld: '新邮箱那一边已经确认，还在等当前邮箱这一边。',
  awaitingNew: '当前邮箱那一边已经确认，还在等新邮箱这一边。',
  sessionsTitle: '登录设备',
  revokeOne: '退出这一台',
  logoutAll: '退出所有设备',
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

  // 🔴 判据是**存在性**：那句"两边都点才生效"必须在点之前就在界面上。
  // 只断言"点了以后出现什么"抓不到"少了一整段说明"这一类缺陷。
  await expect(panel.getByText(COPY.emailChangeIntro)).toBeVisible();

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
