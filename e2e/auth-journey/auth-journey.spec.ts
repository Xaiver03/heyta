/**
 * 认证与同步的关键用户旅程（真浏览器 + 真服务端 + 真 WebAuthn）
 * ==============================================================
 *
 * 这一组把此前**只存在于 jsdom**（`apps/web/tests/`）或**只注入令牌**
 * （`../multi-end/`）的旅程，在真浏览器里从「未登录冷启动」完整走一遍：
 *
 *   J1 注册（通行密钥） → J2 登录（令牌落盘） → J3 数据上行（服务端交叉验证）
 *   → J4 新设备恢复（全新 context = 一台刚装好的设备，数据只能来自服务端）
 *   → J5 退出登录（凭据真的被清掉） → J6 反向：地址错了界面必须说失败
 *
 * ## 🔴 每条用例都是一个新 context = 一台新设备
 *
 * Playwright 默认每条用例给全新 context（空 IndexedDB / 空 localStorage）。
 * 这正好等价于"这台设备刚装好 heyta"：J4 能看到那条任务，**唯一**的解释
 * 是它从服务端拉回来的 —— 这个判据不需要任何 mock 就成立了。
 * 用例之间的共享状态（账号邮箱、通行密钥、任务标题）放在模块变量里
 * （workers=1，同一进程内按文件顺序执行）。
 *
 * ## 🔴 测试账号：每轮经**真实界面**注册一个全新账号
 *
 * `J1` 里点「用通行密钥注册」注册出的账号就是本轮全部用例的账号
 * （`web-auth-<时间戳>@example.com`）。与移动端验收（`scripts/lib/mobile-e2e-fresh-account.sh`）
 * 同一个理由：复用旧账号会让向量时钟预算随运行次数漂移。
 * 与 `/api/test/create-user` 的差别在于：**这里走的是用户真的会走的那条路**，
 * 建号端点根本没被调用。
 *
 * ## 截图纪律（AGENTS.md §6.2 规定一）
 *
 * 每个旅程里程碑先落**固定路径**的截图再跑硬断言；失败另有
 * `trace + screenshot(only-on-failure)` 兜底。图必须**人看**
 * （本轮运行的人看过并在文档里记了结论）。
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { addTask } from '../tests/helpers';
import {
  SERVER,
  acceptTerms,
  attachAuthenticator,
  authStatus,
  freshEmail,
  injectCredential,
  loginWithPasskeyViaUi,
  openApp,
  openAuthPanel,
  readCredentials,
  requireServer,
  serverOpCount,
  setE2eePasswordAndSync,
  statusBar,
  toRegisterMode,
  userIdFromCredentials,
  type VirtualAuthenticator,
} from './helpers';

/** 跨用例的旅程状态。workers=1 + 文件顺序执行 ⇒ 按序消费是安全的。 */
const journey: {
  email: string;
  credential: Record<string, unknown> | null;
  taskTitle: string;
} = {
  email: '',
  credential: null,
  taskTitle: '',
};

/** 服务端预检（每条用例都真需要它；缓存结果避免重复 ping）。 */
let serverChecked = false;
async function ensureServer(request: APIRequestContext): Promise<void> {
  if (!serverChecked) {
    await requireServer(request);
    serverChecked = true;
  }
}

/** 登录所需的完整前置：新 context + 装好凭据的虚拟认证器 + 走完 UI 登录。 */
async function signInOnThisDevice(page: import('@playwright/test').Page): Promise<VirtualAuthenticator> {
  const au = await attachAuthenticator(page);
  if (journey.credential === null) throw new Error('旅程状态里没有通行密钥 —— J1 必须先跑');
  await injectCredential(au, journey.credential);
  await openApp(page);
  const dialog = await openAuthPanel(page);
  await loginWithPasskeyViaUi(page, dialog, journey.email);

  /**
   * 🔴 **登录成功之后必须把凭据快照读回来更新**（2026-09-30 实测）。
   *
   * 虚拟认证器里的 `signCount` **每次认证都会前进**，而 `journey.credential`
   * 还是 J1 注册那一刻的快照。下一次注入旧快照 ⇒ 计数器**倒退**，
   * 服务端按 FIDO 规范**拒收**，界面文案是
   * 「通行密钥验证没有通过，可以再试一次」—— 而密码学上其实什么都没坏。
   *
   * ⚠️ 症状与"凭据不存在"很像，别照那个方向查；Windows 侧踩过同一条。
   */
  const advanced = await readCredentials(au);
  if (advanced.length > 0) journey.credential = advanced[0]!;

  return au;
}

test('J1 未登录注册：头像菜单 → 登录/注册 → 用通行密钥注册出一个全新账号', async ({
  page,
  request,
}) => {
  await ensureServer(request);
  journey.email = freshEmail();

  await openApp(page);
  const au = await attachAuthenticator(page);

  // 里程碑截图（先落图，再断言）。
  await page.screenshot({ path: 'test-results/auth-journey-1-signed-out.png' });

  const dialog = await openAuthPanel(page);

  // 表单现在分两屏、注册是第二屏里再切的一档（同意项只在注册档渲染）。
  // 这三步是**用户真的要点**的，不是测试的走捷径 —— 见 helpers 的
  // `toCredentialStage` / `toRegisterMode`。
  await toRegisterMode(dialog, journey.email);
  await acceptTerms(dialog);
  await dialog.getByRole('button', { name: '用通行密钥注册' }).click();

  // TEST_MODE 自动验证 ⇒ 界面显示的是"注册申请已提交…"那段文案。
  // 🔴 生产上这句后面是"去邮箱点链接"；TEST_MODE 里账号已验证，
  //    所以下一条用例可以直接用通行密钥登录 —— 这正是 J2。
  await expect(authStatus(dialog)).toContainText('注册申请已提交');

  // 判据本体：虚拟认证器里**真的多了一把凭据**（真 WebAuthn，不是 stub）。
  const creds = await readCredentials(au);
  expect(creds.length, '注册应当在本机产生一把通行密钥').toBe(1);
  journey.credential = creds[0]!;

  await page.screenshot({ path: 'test-results/auth-journey-2-registered.png' });

  // 注册 ≠ 登录：此刻还没有任何令牌落盘。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '注册（未登录）不得写入任何凭据').toBeNull();
});

test('J2 登录：同一把通行密钥拿到令牌，身份区出现邮箱且凭据落盘', async ({
  page,
  request,
}) => {
  await ensureServer(request);

  await signInOnThisDevice(page);
  // 登录成功 ⇒ 认证面板自动关闭（SyncBar 的 onSignedIn → closeSignIn）。

  // 🔴 凭据落盘的判据：baseUrl / token / email 在，**口令永远不在**
  //    （`sync/store.ts` 的安全取舍 —— 口令只活在内存/sessionStorage）。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '登录后凭据必须落盘（否则"登录后重开还在"不成立）').not.toBeNull();
  const parsed = JSON.parse(stored!) as {
    baseUrl?: string;
    token?: string;
    email?: string;
    password?: string;
  };
  expect(parsed.baseUrl).toBe(SERVER);
  expect(parsed.token, '令牌必须已经拿到').toBeTruthy();
  expect(parsed.email).toBe(journey.email);
  expect(parsed.password, 'E2EE 口令绝不允许落盘').toBeUndefined();

  // 身份区：头像菜单里出现邮箱，登录/注册与退出登录的可见性随之翻转。
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-email')).toHaveText(journey.email);
  await expect(page.getByTestId('sync-signin-entry')).toHaveCount(0);
  await expect(page.getByTestId('account-menu-signout')).toBeVisible();

  await page.screenshot({ path: 'test-results/auth-journey-3-signed-in.png' });
});

test('J3 数据上行：登录后建任务、补口令同步，服务端必须真的收到 op', async ({
  page,
  request,
}) => {
  await ensureServer(request);

  await signInOnThisDevice(page);

  journey.taskTitle = `auth-journey-task-${Date.now()}`;
  await addTask(page, journey.taskTitle);

  // 登录只写了令牌；口令是每个新会话都要用户补的一步（它从不落盘）。
  await setE2eePasswordAndSync(page);
  await expect(statusBar(page)).toContainText('已同步');

  // 🔴 界面说"已同步"在上传被拒收时同样会出现（本仓已两次被骗过）——
  //    所以必须到**服务端**数出 op：这条账号的 operations ≥ 1。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  const userId = userIdFromCredentials(stored!);
  const ops = await serverOpCount(request, userId);
  expect(ops, `服务端必须存有该账号的 op（界面已报"已同步"），实际 ${String(ops)} 条`).toBeGreaterThanOrEqual(1);

  await page.screenshot({ path: 'test-results/auth-journey-4-synced.png' });
});

test('J4 新设备恢复：全新 context 登录同账号，那条任务只能来自服务端', async ({
  page,
  request,
}) => {
  await ensureServer(request);
  if (journey.taskTitle === '') throw new Error('J3 必须先跑（本用例依赖它上传的任务）');

  // 新 context = 空 IndexedDB / 空 localStorage = 一台刚装好的设备。
  await signInOnThisDevice(page);
  await setE2eePasswordAndSync(page);
  await expect(statusBar(page)).toContainText('已同步');

  await expect(
    page.locator('[data-testid^="task-item-"]').filter({ hasText: journey.taskTitle }),
    '新设备上必须能看到那条任务 —— 它只可能来自服务端',
  ).toBeVisible();

  await page.screenshot({ path: 'test-results/auth-journey-5-second-device.png' });
});

test('J5 退出登录：落盘凭据被清掉，身份入口翻回未登录形态', async ({ page, request }) => {
  await ensureServer(request);

  await signInOnThisDevice(page);

  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-email')).toBeVisible();

  await page.getByTestId('account-menu-signout').click();

  /**
   * 🔴 **退出登录会把菜单关掉**（2026-09-30 实测）。
   *
   * 所以"退出登录项不存在"在菜单**关闭**时是**空真** —— 那一条判据什么都没判。
   * 必须重新点开头像，在**打开**的菜单上断言它的内容。
   * ⚠️ Windows 侧（W5）踩过完全同一条；本仓对"空真"的判据一向要求显式处理。
   */
  await expect(page.getByTestId('account-menu-email')).toHaveCount(0);
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-panel')).toBeVisible();

  // 未登录形态翻回来：身份区消失、登录/注册回到第一项、退出登录语义上不存在。
  const items = page.getByTestId('account-menu-panel').getByRole('menuitem');
  await expect(items.first()).toHaveAttribute('data-testid', 'sync-signin-entry');
  await expect(page.getByTestId('account-menu-signout')).toHaveCount(0);

  // 🔴 只清内存不够：落盘的那份必须也没了，否则刷新一次令牌就"活"回来。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '退出登录必须清掉落盘凭据').toBeNull();

  await page.screenshot({ path: 'test-results/auth-journey-6-signed-out-again.png' });
});

test('J6 反向：服务端地址错了，界面必须说出失败而不是假装成功', async ({
  page,
  request,
}) => {
  await ensureServer(request);

  await openApp(page);
  await attachAuthenticator(page);
  const dialog = await openAuthPanel(page);

  // 127.0.0.1:9 （discard 端口）上没有服务端 —— 注册必须失败且**可见**。
  // 先把表单走到注册档（它会预填真实服务端地址），再把地址**改坏**：
  // 这一改是这条用例的全部内容，所以必须发生在 `toRegisterMode` 之后。
  await toRegisterMode(dialog, freshEmail());
  await dialog.getByTestId('auth-form-server-url').fill('http://127.0.0.1:9');
  await acceptTerms(dialog);
  await dialog.getByRole('button', { name: '用通行密钥注册' }).click();

  await expect(
    authStatus(dialog),
    '连不上服务端时界面必须给出失败文案',
  ).toContainText('连不上服务端');
  await expect(authStatus(dialog)).not.toContainText('注册申请已提交');

  // 失败不得被当成半次成功：仍然没有凭据落盘。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '失败的注册不得写入任何凭据').toBeNull();

  await page.screenshot({ path: 'test-results/auth-journey-7-failure-visible.png' });
});

/**
 * J7：桌面壳的**反向授权回跳**（ADR-0039 §2.3）
 *
 * 壳里做不了通行密钥（`uvpaa=false`），所以把鉴权交给**系统浏览器**：
 * 壳打开 `/?auth=desktop&state=…`，用户在浏览器里正常登录，
 * 应用登录成功后回跳 `heyta://auth#token=…&state=…`，壳校验 `state` 后接管。
 *
 * 🔴 这条用例断言的是**回跳地址本身**，不是"某个函数被调了"：
 *    令牌必须在 fragment 里、`state` 必须原样带回。
 * ⚠️ 依赖 J1（通行密钥由它建）；与 J2–J5 同一约定。
 */
test('J7 桌面壳反向授权：登录后回跳 heyta://auth#token=…&state=…，令牌不进 query', async ({
  page,
  request,
}) => {
  await ensureServer(request);
  const state = `st-${String(Date.now())}`;

  await openApp(page, `/?auth=desktop&state=${state}`);
  const au = await attachAuthenticator(page);
  if (journey.credential === null) throw new Error('旅程状态里没有通行密钥 —— J1 必须先跑');
  await injectCredential(au, journey.credential);

  const dialog = await openAuthPanel(page);
  await loginWithPasskeyViaUi(page, dialog, journey.email);

  // 登录成功 ⇒ 应用应当把令牌 + state 交回壳，并留一个**可点的**兜底入口。
  const link = page.getByTestId('desktop-handoff-link');
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';

  expect(href.startsWith('heyta://auth#')).toBe(true);
  expect(href).toContain('token=');
  expect(href).toContain(`state=${state}`);
  // 🔴 令牌**不许**出现在 query 里（那会进 Referer 与沿途每一层日志）。
  expect(href.split('#')[0]).not.toContain('token=');

  await page.screenshot({ path: 'test-results/auth-journey-8-desktop-handoff.png' });
});
