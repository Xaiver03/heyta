/**
 * 认证旅程的公共步骤（真浏览器 + 真服务端 + 真 WebAuthn）。
 * =========================================================
 *
 * 这些用例**故意不在** `e2e/tests/` 里 —— 那个目录由离线的
 * `playwright.config.ts` 驱动并挂在 `pnpm check` 上。放在这里，
 * 就只会由 `pnpm verify:web-auth`（及其运行器）拉起。
 *
 * 🔴 **服务端地址走环境变量，且必须显式检查非空**（与 `../multi-end/helpers.ts`
 * 同一条纪律）：忘了导出变量的运行必须当场报错，而不是静默变成
 * "配置了空地址、注册必然失败"的一堆红。
 *
 * ## 🔴 通行密钥的"系统弹窗"由虚拟认证器真实应答
 *
 * 注册/登录那两步 `navigator.credentials.create()/get()` 是**真的在跑** ——
 * Playwright 通过 CDP 挂一个虚拟认证器（`WebAuthn.enable` +
 * `addVirtualAuthenticator`），让系统弹窗不用人就能完成。
 * 它不是 stub：challenge / 签名 / origin 校验全部真实发生，
 * 服务端验签失败这条测试照样红。
 *
 * "新设备"用例把第一台设备注册出的凭据（含私钥）**原样搬进**第二台设备的
 * 虚拟认证器 —— 等价于用户把同一把通行密钥装到了新机器上，
 * 于是"换一台设备还能登录同一个账号"这条路可以被自动化。
 */

import { expect, type CDPSession, type Locator, type Page } from '@playwright/test';

import { openApp as openSharedApp, rowFor } from '../tests/helpers';

export { rowFor };

/** 服务端地址（由 `scripts/verify-web-auth-journey.mjs` 传入）。 */
export const SERVER = process.env['HEYTA_AUTH_JOURNEY_SERVER'] ?? '';

/** 缺地址就当场报错；顺带 ping 一下 /health，服务端没起来也要说清楚。 */
export async function requireServer(request: import('@playwright/test').APIRequestContext): Promise<void> {
  if (SERVER === '') {
    throw new Error(
      '缺环境变量 HEYTA_AUTH_JOURNEY_SERVER —— ' +
        '这个套件必须由 `pnpm verify:web-auth`（scripts/verify-web-auth-journey.mjs）启动。',
    );
  }
  const res = await request.get(`${SERVER}/health`).catch(() => null);
  expect(
    res?.ok(),
    `服务端 ${SERVER} 不可达 —— 先由运行器以 TEST_MODE 拉起服务端再跑本套件`,
  ).toBe(true);
}

/** 每轮一个全新账号（与移动端验收同一理由：向量时钟预算 + 干净状态）。 */
export function freshEmail(): string {
  return `web-auth-${Date.now()}@example.com`;
}

/** E2EE 口令。每轮换账号 ⇒ 固定值即可；它**只**存在于本进程与内存。 */
export const E2EE_PASSWORD = 'auth-journey-e2ee-pass';

export interface VirtualAuthenticator {
  readonly cdp: CDPSession;
  readonly authenticatorId: string;
}

/**
 * 虚拟认证器的参数 —— **全仓唯一一份**。
 *
 * 🔴 **Chromium 153 改了 CDP schema**（2026-09-30 实测，Playwright 1.63 自带的
 * chromium-1243）：`protocol` 的枚举从 `usb|nfc|ble|internal` 收窄成 **`ctap2`**
 * （CTAP1/U2F 已删），且 `transport` 成为**必填**字段。旧写法
 * `{ protocol: 'internal' }` 会报 "Invalid parameters"，而
 * `{ protocol: 'internal', transport: 'internal' }` 报 "The protocol is not valid"
 * —— 两个错误指代完全不同的成因，别混着猜。
 *
 * ⚠️ 抽成常量是因为**桌面壳那条路要另建/回收认证器**（WebView2 只允许一个
 * internal 认证器，见 `../windows-shell/helpers.ts`）。参数写两份就会在这里漂移，
 * 而漂移的表现是"某一端突然说 Invalid parameters"。
 */
export const VIRTUAL_AUTHENTICATOR_OPTIONS = {
  protocol: 'ctap2',
  transport: 'internal',
  hasResidentKey: true,
  hasUserVerification: true,
  isUserVerified: true,
  automaticPresenceSimulation: true,
} as const;

/** 往一个已经 `WebAuthn.enable` 过的 CDP session 上挂一个虚拟认证器，返回它的 id。 */
export async function addVirtualAuthenticator(cdp: CDPSession): Promise<string> {
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: VIRTUAL_AUTHENTICATOR_OPTIONS,
  });
  return authenticatorId;
}

/**
 * 给当前页面挂一个可发现凭据、已验证用户的虚拟认证器。
 *
 * `existing` 让调用方复用它已经拿到的 CDP session（桌面壳那条路上，fixture
 * 为了"设备重置"已经开了一个）—— 不传就自己开一个，行为不变。
 */
export async function attachAuthenticator(
  page: Page,
  existing?: CDPSession,
): Promise<VirtualAuthenticator> {
  const cdp = existing ?? (await page.context().newCDPSession(page));
  await cdp.send('WebAuthn.enable');
  return { cdp, authenticatorId: await addVirtualAuthenticator(cdp) };
}

type WebAuthnCredential = Record<string, unknown>;

/** 读出虚拟认证器里的全部凭据（含私钥 —— 搬运到"新设备"要用）。 */
export async function readCredentials(au: VirtualAuthenticator): Promise<WebAuthnCredential[]> {
  const { credentials } = await au.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: au.authenticatorId,
  });
  return credentials as WebAuthnCredential[];
}

/** 把一台设备上的凭据装进另一台设备的虚拟认证器。 */
export async function injectCredential(
  au: VirtualAuthenticator,
  credential: WebAuthnCredential,
): Promise<void> {
  await au.cdp.send('WebAuthn.addCredential', {
    authenticatorId: au.authenticatorId,
    credential,
  });
}

/**
 * 打开真应用并等到输入框可见（白屏不算通过）。
 * 转接共享 helper（模块开关全开 + 垫片自动失效），保持一份"打开应用"的实现。
 */
export async function openApp(page: Page): Promise<void> {
  await openSharedApp(page);
}

/**
 * 走完「头像 → 登录/注册 → 面板」这一段，返回认证面板。
 *
 * 🔴 这两次点击本身就是**身份入口的旅程**（未登录时菜单第一项是登录/注册），
 * 所以每条用例都真实地点，不许用 `localStorage` 直接把 `signInOpen` 置真。
 *
 * 🔴 **幂等**（2026-09-30 补）：桌面壳是**常驻进程**，界面状态跨用例留存 ——
 * 菜单可能已经开着（壳启动时会自己点一次头像去验 M2-D 的身份菜单 IA），
 * 面板也可能已经开着。此时再点一次是**把它们关掉**，症状是
 * "waiting for sync-signin-entry" 超时，看起来像入口不存在，
 * 实际是入口已经打开着。所以先探状态，只在需要时点。
 */
export async function openAuthPanel(page: Page) {
  const dialog = page.locator('[role="dialog"][aria-label="登录 / 注册"]');
  if (await dialog.isVisible().catch(() => false)) return dialog;

  const entry = page.getByTestId('sync-signin-entry');
  if (!(await entry.isVisible().catch(() => false))) {
    await page.getByTestId('account-menu-avatar').click();
  }
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * 在认证面板里用通行密钥登录（凭据须已装进本页的虚拟认证器）。
 *
 * 🔴 **成功判据不是"面板里出现已登录"** —— 那是一个**瞬时**状态。
 * 登录成功后面板会自动关闭（`SyncBar` 的 `onSignedIn → closeSignIn`），
 * 所以只断言"已登录"等于在赌自己赢得这场竞态。
 *
 * 2026-09-30 实测（Windows 桌面壳）：面板**稳定先关**，
 * 4 条登录用例全红，而服务端日志明写 `User logged in via passkey (ID: 4)`、
 * 令牌也已落盘、同步 WebSocket 也已经连上 —— **产品是对的，断言是错的**。
 * 这个竞态在 vite 上也存在，只是在那边恰好常常赢。
 *
 * ⇒ 正确的判据是**两者之一**：面板关掉（成功的强信号），或面板内出现"已登录"。
 *    另外，失败时界面文案会从空态变成失败原因 —— 那就当场报，
 *    不要让它白等满 120 秒才吐一个超时（超时看不出真正原因）。
 */
export async function loginWithPasskeyViaUi(
  page: Page,
  dialog: Locator,
  email: string,
): Promise<void> {
  await dialog.locator('input[type="url"]').fill(SERVER);
  await dialog.locator('input[type="email"]').fill(email);

  const status = authStatus(dialog);
  const emptyCopy = ((await status.textContent().catch(() => '')) ?? '').trim();

  await dialog.getByRole('button', { name: '用通行密钥登录' }).click();

  const deadline = Date.now() + 120_000;
  let last = '';
  while (Date.now() < deadline) {
    // ① 面板关掉 = 登录成功（这正是产品实际的行为）。
    if (!(await dialog.isVisible().catch(() => false))) return;

    last = ((await status.textContent().catch(() => '')) ?? '').trim();
    // ② 面板还开着但已经显示"已登录"（另一种合法形态）。
    if (last.includes('已登录')) {
      await expect(status).toContainText(email);
      return;
    }
    // ③ 文案离开空态 ⇒ 这是**失败**（`busy` 期间渲染的仍是空态，不会误判）。
    if (last !== '' && last !== emptyCopy) {
      throw new Error(`通行密钥登录失败，界面文案：${last.slice(0, 200)}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`通行密钥登录超时；最后一次界面文案：${last.slice(0, 200)}`);
}

/**
 * 在同步设置对话框里填好端到端加密口令并保存。
 *
 * ⚠️ 登录只写入 baseUrl + 令牌 + 邮箱（`applyAuthToken`）；**口令从不落盘**
 * （`apps/web/src/features/sync/store.ts` 文件头的安全取舍），所以
 * "登录之后补口令"是每个新会话的真实用户步骤，不是测试的走捷径。
 */
export async function setE2eePasswordAndSync(page: Page): Promise<void> {
  await page.getByRole('button', { name: '同步设置' }).click();
  const dialog = page.getByRole('dialog', { name: '同步设置' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('端到端加密口令').fill(E2EE_PASSWORD);
  await dialog.getByRole('button', { name: '保存并同步' }).click();
  await expect(dialog).toBeHidden();
}

/** 同步状态条（与 `../multi-end/helpers.ts` 同一结构定位，理由见那边）。 */
export function statusBar(page: Page) {
  return page.locator('div[role="status"]').filter({ has: page.getByLabel('立即同步') });
}

/**
 * 认证面板的**主**状态区。
 *
 * 🔴 面板里有**两个** `role="status"`：这一个（空态/已登录/失败都在这渲染），
 * 加上通行密钥等待期的"请在系统弹窗里完成操作…"提示（`AuthPanel` 的
 * `waitingForPasskey`）。裸取 `[role="status"]` 会撞 strict mode；
 * 主状态区在 DOM 序里**永远在前**（它在表单上方），所以用 `.first()`。
 */
export function authStatus(dialog: Locator) {
  return dialog.locator('[role="status"]').first();
}

/** 按「立即同步」并等到状态变成「已同步」。 */
export async function syncNow(page: Page): Promise<void> {
  await statusBar(page).getByLabel('立即同步').click();
  await expect(statusBar(page)).toContainText('已同步');
}

/**
 * 从落盘凭据里解出 JWT 的 payload，拿 userId —— 供服务端交叉验证用。
 * 🔴 只做 base64 解码，**不验签**：这里不是在认证，是在读"我是谁"。
 */
export function userIdFromCredentials(credentialsJson: string): number {
  const parsed = JSON.parse(credentialsJson) as { token?: string };
  if (typeof parsed.token !== 'string' || parsed.token === '') {
    throw new Error(`落盘凭据里没有令牌：${credentialsJson.slice(0, 120)}`);
  }
  const payload = parsed.token.split('.')[1];
  if (payload === undefined) throw new Error('令牌不是三段式 JWT');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    userId?: number;
  };
  if (typeof decoded.userId !== 'number') throw new Error('JWT payload 里没有 userId');
  return decoded.userId;
}

/** 读该账号在服务端的 op 行数（TEST_MODE 路由；载荷是密文，只能数数与看形状）。 */
export async function serverOpCount(
  request: import('@playwright/test').APIRequestContext,
  userId: number,
): Promise<number> {
  const res = await request.get(`${SERVER}/api/test/user/${String(userId)}/ops?limit=100`);
  expect(res.ok(), '服务端 /api/test/user/:id/ops 应该可用（TEST_MODE）').toBe(true);
  const body = (await res.json()) as { ops: unknown[] };
  return body.ops.length;
}
