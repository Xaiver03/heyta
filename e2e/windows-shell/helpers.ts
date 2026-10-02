/**
 * Windows 桌面壳（WinUI 3 + WebView2）里的**真应用** —— 旅程验收的公共步骤
 * ====================================================================
 *
 * 与 `../auth-journey/helpers.ts`（vite 上的 web）**不是**同一份实现：
 * 那边的 `page` 由 Playwright 自己启动的 chromium 提供，这边是从
 * **另一台机器**上已经跑着的壳经 CDP **附着**上去的。这个差别带来三件事，
 * 每一条都是实测撞出来的，不是设计洁癖：
 *
 * 1. 🔴 **必须先证明连的是我们的壳。** 2026-09-30 实测：本机 Chrome 正好也
 *    监听在探针想用的 9223 上，`connectOverCDP` 连上去、拿到 24 个页面、
 *    一切"正常"—— 而那是**用户自己的浏览器**。`docs/runbooks/desktop.md`
 *    §5.5 记过同一个形状（那台 Windows 上 9222 被一个无关的 Tauri 应用占着）。
 *    ⇒ `assertCdpIsOurShell()` 是**连接之前**的硬闸门，不是可选体检。
 *
 * 2. 🔴 **没有"每条用例一个新 context"。** Playwright 在自建浏览器里靠新
 *    context 造"一台刚装好的设备"；附着到一个常驻 WebView2 没有这个能力。
 *    所以这里用 `resetDevice()`：清掉该 origin 的全部存储 + 重载，并**断言**
 *    回到未登录、无落盘凭据、无任务 —— 与"新设备"等价的判据，而且是显式的。
 *
 * 3. 🔴 **`goto('/')` 不行。** 文件夹映射下 `/` 不是 `index.html`，会被
 *    service worker 兜成 `503 离线`（实测），于是"应用打不开"看起来像
 *    "服务端离线"。必须显式导航到 `/index.html`。
 */

import { expect, test as base, chromium, type Browser, type CDPSession, type Page } from '@playwright/test';

import { addVirtualAuthenticator, type VirtualAuthenticator } from '../auth-journey/helpers';
import { decidePrivacyConsent, enableAllModules, pinChineseUi } from '../tests/helpers';
import { installMissingProducerShims } from '../tests/shims';

/** 壳里真应用的 origin（`SetVirtualHostNameToFolderMapping` 的虚拟主机名）。 */
export const SHELL_ORIGIN = 'https://heyta.local';

/** 真应用的入口。⚠️ 不是 `/`，理由见文件头第 3 条。 */
export const SHELL_URL = `${SHELL_ORIGIN}/index.html`;

export const CDP_ENDPOINT = process.env['HEYTA_WIN_CDP'] ?? 'http://127.0.0.1:9287';

/**
 * 身份闸门：**在 connectOverCDP 之前**证明这个 CDP 端点是我们自己的壳。
 *
 * 三条判据缺一不可，因为每一条都能单独被骗过：
 *   - `Browser` 以 `Edg/` 开头 ⇒ 是 Edge/WebView2 内核（本机 Chrome 是 `Chrome/`）；
 *   - UA 含 `Windows NT` ⇒ 端点在 Windows 上，不是本机；
 *   - `/json/list` 里**有 `https://heyta.local/` 的 page 目标** ⇒ 壳真的加载了真应用。
 *
 * 只验端口通不通是不够的 —— 端口通恰恰是骗过上一版探针的那个形态。
 */
export async function assertCdpIsOurShell(endpoint: string): Promise<string> {
  const versionRes = await fetch(`${endpoint}/json/version`).catch(() => null);
  if (resVersionUnreachable(versionRes)) {
    throw new Error(
      `CDP 端点 ${endpoint} 不可达 —— 壳没起来，或者 CDP 隧道没开。\n` +
        '  ⇒ 必须先跑 `pnpm verify:windows-auth`（它负责在交互式会话里启动壳并开隧道）。',
    );
  }
  const version = (await versionRes.json()) as { Browser?: string; 'User-Agent'?: string };
  const browser = version.Browser ?? '';
  const ua = version['User-Agent'] ?? '';

  if (!/^Edg\//.test(browser)) {
    throw new Error(
      `🔴 CDP 端点 ${endpoint} 上跑的是 **${browser || '未知浏览器'}**，不是 Edge/WebView2。\n` +
        '   ⇒ 拒绝继续：2026-09-30 实测踩过 —— 本机 Chrome 正好也监听同一个端口，\n' +
        '     connectOverCDP 连上去、拿到页面列表、一切"正常"，而那是**用户自己的浏览器**。\n' +
        '     这不是"环境不干净"，是**连错了被测对象**，必须响亮失败。',
    );
  }
  if (!/Windows NT/.test(ua)) {
    throw new Error(`🔴 CDP 端点 ${endpoint} 不在 Windows 上（UA=${ua}）—— 拒绝继续。`);
  }

  const listRes = await fetch(`${endpoint}/json/list`).catch(() => null);
  const targets = listRes === null || !listRes.ok
    ? []
    : ((await listRes.json()) as { type: string; url: string }[]);
  if (!targets.some((t) => t.type === 'page' && t.url.startsWith(`${SHELL_ORIGIN}/`))) {
    throw new Error(
      `🔴 CDP 端点里没有 ${SHELL_ORIGIN}/ 的页面目标 —— 壳加载的不是真应用。\n` +
        `   实际目标：${targets.map((t) => `${t.type}:${t.url}`).join(' | ') || '（空）'}`,
    );
  }
  return browser;
}

function resVersionUnreachable(res: Response | null): boolean {
  return res === null || !res.ok;
}

/**
 * 打开壳里的真应用（模块开关 + 生产模块垫片 + 显式入口 + 非空白判据）。
 *
 * 🔴 语言与首启隐私同意都得在这里做完，两条都是**实测**：
 *   · 中文偏好以前**没有**钉，那条 `添加任务` 锚点之所以能命中，是因为这台打包机
 *     恰好是中文 Windows —— 探针跟着宿主系统语言漂（§7 元规则 1）。换一台英文宿主
 *     它会在第一行就红，而红的是探针不是产品。现在显式写 `heyta.locale`；
 *   · 隐私同意面板（2026-10-01 落地）是一张 `position: fixed; inset: 0` 的整屏遮罩，
 *     rail 也在它底下。W1–W6 每一条都要点界面，不做完这一步就全部卡在
 *     "`<div role=\"presentation\">` … intercepts pointer events" 直到超时。
 *     这里必须答 `accepted`：这套件判的是**真注册、真令牌、真 op 上传**，
 *     而闸门在 `local-only` 下连自建服务器的请求都不放行。
 */
export async function openShellApp(page: Page): Promise<void> {
  await enableAllModules(page);
  await pinChineseUi(page);
  await installMissingProducerShims(page);
  await page.goto(SHELL_URL);
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(page, 'accepted');
}

/**
 * "设备重置"：把这一台（壳）恢复成**刚装好 heyta** 的样子。
 *
 * 清掉该 origin 的**全部**存储类别（IndexedDB / localStorage / Cache /
 * service worker …），重载，然后**断言**三件事都成立：
 *   - 应用画出来了（否则后面的失败会归因到错的地方）；
 *   - 没有任何落盘凭据；
 *   - 本地一条任务都没有。
 *
 * 🔴 第 2、3 条断言是这个套件里"新设备恢复"那条用例能承重的前提：
 *    没有它们，"登录后看到了那条任务"就可能来自**本地残留**而不是服务端。
 */
export async function resetDevice(page: Page, cdp: CDPSession): Promise<void> {
  await cdp.send('Storage.clearDataForOrigin', {
    origin: SHELL_ORIGIN,
    storageTypes: 'all',
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible({ timeout: 90_000 });
  // 🔴 `clearDataForOrigin` 抹的是**全部**存储，里面包括刚才那次隐私同意 ——
  // 所以重置之后面板必然回来。不收掉它，下一条用例的第一次 `click()` 就卡在遮罩上，
  // 而症状写的是"新设备登录不上"。语言偏好同理（`pinChineseUi` 是 init script，
  // 每次导航都会重放，因此它不需要在这里再写一次）。
  await decidePrivacyConsent(page, 'accepted');

  const after = await page.evaluate(() => ({
    credentials: window.localStorage.getItem('heyta.sync.credentials'),
    tasks: document.querySelectorAll('[data-testid^="task-item-"]').length,
  }));
  expect(after.credentials, '设备重置后不得还有落盘凭据').toBeNull();
  expect(after.tasks, '设备重置后本地不得还有任务行（否则"新设备"是假的）').toBe(0);
}

/** 附着到的这一台"设备"。 */
export interface Shell {
  readonly page: Page;
  readonly cdp: CDPSession;
}

/**
 * 整个 worker 共用的那一个虚拟认证器 id。
 *
 * 🔴 **WebView2 只允许一个 internal 虚拟认证器**（实测报错逐字：
 * "Chrome only supports one internal authenticator per environment"）。
 * web 那条路每条用例都是新 context + 新 CDP session，所以各挂各的没问题；
 * 而这里**整个 worker 就只有一台"设备"**（附着到同一个常驻 WebView2），
 * 于是第二条用例再 `addVirtualAuthenticator` 必炸 ——
 * 而症状是 W2–W5 全红、只有 W1 绿，看起来像"登录坏了"。
 */
let sharedAuthenticatorId: string | null = null;

/**
 * 拿到本 worker 的虚拟认证器，并把它**清成空**。
 *
 * 清空是"设备"语义的一部分，而且必须显式做：认证器是跨用例复用的，
 * 不清就会把上一条用例的凭据带进下一条 —— 那样"新设备"就不再是新设备。
 */
async function ensureAuthenticatorId(cdp: CDPSession): Promise<string> {
  await cdp.send('WebAuthn.enable');
  if (sharedAuthenticatorId !== null) return sharedAuthenticatorId;

  try {
    sharedAuthenticatorId = await addVirtualAuthenticator(cdp);
  } catch (error) {
    // 环境里已经有一个**我们不认识的**认证器（上一次运行的会话还没断干净）。
    // `disable` + `enable` 会把它一起清掉 —— 实测可行（2026-09-30）。
    if (!/one internal authenticator/i.test((error as Error).message)) throw error;
    await cdp.send('WebAuthn.disable').catch(() => undefined);
    await cdp.send('WebAuthn.enable');
    sharedAuthenticatorId = await addVirtualAuthenticator(cdp);
  }
  return sharedAuthenticatorId;
}

/** 本"设备"的虚拟认证器（已清空）：注册用例得到空认证器，登录用例再自行装入凭据。 */
export async function shellAuthenticator(shell: Shell): Promise<VirtualAuthenticator> {
  const authenticatorId = await ensureAuthenticatorId(shell.cdp);
  await shell.cdp.send('WebAuthn.clearCredentials', { authenticatorId });
  return { cdp: shell.cdp, authenticatorId };
}

/**
 * `shell` fixture：把**壳里的那个页面**交给用例，并在交给之前重置设备。
 *
 * ⚠️ 刻意**不**提供名为 `page` 的 fixture：一旦有谁请求了内置 `page`，
 * Playwright 就会启动一个**本地**浏览器，而那正是本套件要避免的假绿。
 */
export const test = base.extend<{ shell: Shell }, { shellBrowser: Browser }>({
  shellBrowser: [
    async ({}, use) => {
      await assertCdpIsOurShell(CDP_ENDPOINT);
      const browser = await chromium.connectOverCDP(CDP_ENDPOINT);
      await use(browser);
      // 🔴 **故意不调用 `browser.close()`**：connectOverCDP 的 close 会把
      //    **壳本身**关掉（那是别人的进程，不是我们起的）。worker 退出时
      //    WebSocket 自然断开就够了。
    },
    { scope: 'worker' },
  ],

  shell: async ({ shellBrowser }, use) => {
    const page = shellBrowser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().startsWith(`${SHELL_ORIGIN}/`));
    if (page === undefined) {
      throw new Error(
        `附着到壳之后找不到 ${SHELL_ORIGIN}/ 的页面 —— 壳可能在启动后又导航走了。`,
      );
    }
    const cdp = await page.context().newCDPSession(page);
    await resetDevice(page, cdp);
    await use({ page, cdp });
  },
});

export { expect };
