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
 *
 * 🔴 这里的同意决定**必须是 `accepted`**，不是共享层的默认档：这条套件的每一件
 * 事都要出门（真注册、真令牌、真 op 上传、真 `/api/test/*` 交叉验证），而
 * `apps/web/src/features/privacy/consent-gate.ts` 把 `window.fetch` **整体**换成了
 * 同意闸门后的版本 —— `local-only` 下连 `127.0.0.1` 的请求都发不出去。
 * 症状长得很骗人：界面报"连不上服务端"，而服务端日志一条请求都没有（§7 的 CORS
 * 那一坑是同一个形状）。选 `accepted` 不是"测试走捷径"：这条旅程判的就是
 * **同意联网之后**该发生的事。
 */
export async function openApp(page: Page, path = '/'): Promise<void> {
  await openSharedApp(page, path, 'accepted');
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
 *
 * 🔴 **"离开空态"要按前缀判，不能按相等判**（2026-10-02 迁到共享表单时实测的形状）：
 * 共享表单把**等待提示**（「请在系统弹窗里完成操作…」）渲染成状态区的**子节点**
 * （`AuthForm.tsx` 的 `auth-form-busy` 那一行就在 `auth-form-status` 里面），
 * 所以发起请求的那一刻 `textContent()` 就变成「空态文案 + 等待文案」。
 * 老写法 `last !== emptyCopy` 会把它读成**失败**并当场抛 ——
 * 症状是"一条正常登录被报成失败"，而服务端日志里登录是成功的。
 * 空态与错误态在表单里是**三元互斥**的两套节点，错误永远不可能以空态文案开头，
 * 所以 `startsWith(空态文案)` 正好圈出"仍在等待"，把等待和失败分开。
 * ⚠️ 代价：空态文案取不到（`emptyCopy === ''`）时这一条判不了失败，只会走超时；
 *    那属于探针本身没落到东西，超时信息里会带最后一次文案。
 */
export async function loginWithPasskeyViaUi(
  page: Page,
  dialog: Locator,
  email: string,
): Promise<void> {
  // 第一屏只要邮箱；「用通行密钥登录」在第二屏，所以这一段是**必经之路**，
  // 不是走捷径（见 `toCredentialStage`）。
  await toCredentialStage(dialog, email);

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
    // ③ 文案不再以空态开头 ⇒ 空态已被**替换**成失败原因（等待只会追加，见文件头）。
    if (last !== '' && !last.startsWith(emptyCopy)) {
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
 * 🔴 取 `data-testid` 而不是 `[role="status"]`：面板现在由**共享表单**
 * (`packages/ui/src/auth/AuthForm.tsx`) 渲染，状态区是一条 **live region**
 * （RN 的 `accessibilityLiveRegion="polite"` 在 web 上落 `aria-live`，
 * **不产生** `role="status"`）。旧写法会一路找不到元素，症状是
 * "waiting for [role=status]" 超时 —— 那看起来像"界面没状态"，
 * 实际是状态区换了身份标记。
 *
 * ⚠️ 用 testID 的另一个理由：它是**表单自己的契约**，每轮验收都在断言它存在
 * （`apps/web/tests/auth-panel.spec.tsx`），所以这里的定位不会悄悄和界面脱钩。
 */
export function authStatus(dialog: Locator) {
  return dialog.getByTestId('auth-form-status');
}

/**
 * 把「我自己部署」那一栏露出来，返回"这一轮到底有没有地址栏可填"。
 *
 * 🔴 2026-10-02 起**未配置 ≠ 地址栏在场**：G-28（`4774b07e`）把自建地址与粘贴令牌
 * 收进了展开入口，默认 DOM 里既没有 `auth-form-server-url` 也没有 `auth-form-paste`
 * （产品契约钉在 `apps/web/tests/auth-entry-default.spec.tsx` 的 B 段）。
 * 探针原来只写 `if (isVisible) fill` ⇒ 这一档从此**静默跳过填地址**，
 * 于是要么红在"元素没找到"（`verify:legal-links` 实测 4 红），
 * 要么更糟：整条旅程对着**应用自身来源**而不是 `SERVER` 跑 yet 判据全绿。
 *
 * 三种现场分开处理，且**不许再用"看不见就当没事"**：
 *   1. 栏已可见 —— 宿主没给折叠入口（移动壳现状），直接可用；
 *   2. 有展开入口 —— web 未配置服务端：点它，并断言栏真的出现；
 *   3. 两者都没有 —— 这台已经在同步设置里配好服务端，产品明令
 *      "不给第二个地址来源"（`auth-journey.spec.tsx` 那条），所以不填。
 */
export async function revealSelfHostField(dialog: Locator): Promise<boolean> {
  const field = dialog.getByTestId('auth-form-server-url');
  if (await field.isVisible().catch(() => false)) return true;

  const toggle = dialog.getByTestId('auth-form-self-host-toggle');
  if (!(await toggle.isVisible().catch(() => false))) return false;

  await toggle.click();
  await expect(field, '点「我自己部署」之后服务端地址栏必须出现').toBeVisible();
  return true;
}

/**
 * 把表单走到**第二屏**（口令 / 通行密钥 / 魔法链接那一屏）。
 *
 * 🔴 现在第一屏**只要邮箱**，其余一条链都藏在「继续」后面（FIDO 混合登录的
 * 常规做法，也是"地址不能当第一栏"那条硬约束的连带结果）。所以任何要点
 * 「用通行密钥登录」的调用方都必须先走这一步 —— 少了它，按钮根本不在 DOM 里。
 *
 * 🔴 **幂等**，理由同 `openAuthPanel`：桌面壳是常驻进程，用例之间界面状态会留存，
 * 可能已经停在第二屏；而地址栏只在 `baseUrl` **未配置**时才存在
 * （宿主那边由 `isUnconfigured(baseUrl)` 门控），且未配置时它现在还要**先展开**
 * （见 `revealSelfHostField`），上一轮配好以后它就不存在了。
 * 两种"已经点过了"都当成正常路径，不再点第二次。
 *
 * ⚠️ `SERVER` 为空时**一个字都不写**：调用方里有一组（`verify:legal-links` 的
 * "没人碰过地址栏"那一档）判的正是"草稿保持宿主的预填值"，
 * 在这里 `fill('')` 会把它变成"用户把地址清空了"——那是另一件事。
 * 缺地址的套件本来就被 `requireServer()` 当场拦下，不靠这里兜。
 */
export async function toCredentialStage(dialog: Locator, email: string): Promise<void> {
  if (SERVER !== '' && (await revealSelfHostField(dialog))) {
    await dialog.getByTestId('auth-form-server-url').fill(SERVER);
  }

  const continueButton = dialog.getByTestId('auth-form-continue');
  if (!(await continueButton.isVisible().catch(() => false))) return;

  await dialog.getByTestId('auth-form-email').fill(email);
  await continueButton.click();
  await expect(continueButton).toBeHidden();
}

/**
 * 把表单走到**注册档**（服务端地址之后的第二步里再切一档）。
 *
 * 🔴 共享表单的 `mode` 默认是 `sign-in`，而**同意项和邀请码只在注册档渲染**
 * （`AuthForm.tsx` 的 `mode === 'register'` 那一块）。服务端在没有 `termsAccepted`
 * 时会拒绝注册（`store.ts` 的 `registerPasskey` 只在为真时才把该字段带上），
 * 所以注册这条路**必须**先点 `auth-form-switch-mode` —— 少这一步的红是 400，
 * 看起来像服务端坏了。
 *
 * 判"是否已经在注册档"用的是**同意项在不在**而不是按钮文案：
 * 文案是词条（会跟着双语变），同意项是结构（跟着档位变）。
 */
export async function toRegisterMode(dialog: Locator, email: string): Promise<void> {
  await toCredentialStage(dialog, email);

  const terms = dialog.getByTestId('auth-form-terms');
  if (await terms.isVisible().catch(() => false)) return;

  await dialog.getByTestId('auth-form-switch-mode').click();
  await expect(terms).toBeVisible();
}

/**
 * 勾上服务条款同意项，并**验它真的勾上了**。
 *
 * 🔴 不用 `getByRole('checkbox').check()`：共享表单的同意项是
 * `accessibilityRole="checkbox"` 的 `Pressable`（web 落 `div[role=checkbox][aria-checked]`），
 * 没有原生 input；`check()` 在那种元素上会不会生效取决于 Playwright 版本对
 * `aria-checked` 的支持。点 + 断言 `aria-checked="true"` 是版本无关的写法，
 * 而且顺手把"点到了但状态没变"这种空真排除掉。
 */
export async function acceptTerms(dialog: Locator): Promise<void> {
  const terms = dialog.getByTestId('auth-form-terms');
  if ((await terms.getAttribute('aria-checked')) === 'true') return;
  await terms.click();
  await expect(terms).toHaveAttribute('aria-checked', 'true');
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
