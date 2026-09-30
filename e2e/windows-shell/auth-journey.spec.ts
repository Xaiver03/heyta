/**
 * Windows 桌面壳里的真应用 —— 认证与同步的关键用户旅程
 * ==================================================
 *
 * 与 `../auth-journey/auth-journey.spec.ts`（vite 上的 web）**走同一条旅程、
 * 同一套判据**，区别只在宿主形态：这里被测的是 `windows-pc` 上**真壳里的真应用**
 * （WinUI 3 + WebView2 加载 `apps/web/dist`），经 CDP 附着驱动。
 *
 *   J1 注册（通行密钥） → J2 登录（令牌落盘） → J3 数据上行（服务端交叉验证）
 *   → J4 新设备恢复（重置设备后数据只能来自服务端）
 *   → J5 退出登录（凭据真的被清掉） → J6 反向：地址错了界面必须说失败
 *
 * ## 🔴 "新设备"在这里怎么成立
 *
 * web 那条靠 Playwright **每条用例一个新 context**（空 IndexedDB / 空 localStorage）。
 * 附着到一个**常驻**的 WebView2 没有这个能力 ⇒ 这里用 `resetDevice()`
 * （清该 origin 的全部存储 + 重载）并**断言**未登录、无落盘凭据、无任务行。
 * 也就是说：J4 看到那条任务时，本机**已被证伪**没有它 —— 只可能来自服务端。
 *
 * ## 🔴 它是 `check-journey-coverage.mjs` 里 windows 那一格的入口
 *
 * 那一格此前登记的缺口原文是「注册/登录之后的链路（拿令牌、同步、真数据落在壳的
 * SQLite）」。本套件关掉的是**前半段**（拿令牌 + 同步 + 真数据经服务端往返）；
 * ⚠️ 「数据落在**壳的 SQLite**」仍然不成立 —— 壳里的真应用用的是 WebView2
 * 自己的 IndexedDB 存储，与壳的 SQLite 是两份（M2-D 的已知边界，见
 * `docs/research/spikes/m2-webview-shell/README.md` §4d）。**不要读多。**
 */

import { addTask } from '../tests/helpers';
import {
  SERVER,
  authStatus,
  freshEmail,
  injectCredential,
  loginWithPasskeyViaUi,
  openAuthPanel,
  readCredentials,
  requireServer,
  serverOpCount,
  setE2eePasswordAndSync,
  statusBar,
  userIdFromCredentials,
  type VirtualAuthenticator,
} from '../auth-journey/helpers';
import { expect, openShellApp, shellAuthenticator, test, type Shell } from './helpers';

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
async function ensureServer(request: import('@playwright/test').APIRequestContext): Promise<void> {
  if (!serverChecked) {
    await requireServer(request);
    serverChecked = true;
  }
}

/**
 * 登录所需的完整前置：**设备已被 fixture 重置** + 装好凭据的虚拟认证器 + 走完 UI 登录。
 *
 * ⚠️ `resetDevice` 由 `shell` fixture 在用例体之前做掉（本机必须已被证伪没有数据），
 * 所以这里只做"把凭据装进本设备的认证器"这一段。
 *
 * ## 🔴 登录之后必须把凭据快照**收回来**（签名计数器是单调的）
 *
 * 服务端存上一次的签名计数器，并要求本次**严格大于**它 ——
 * 相等直接拒。实测报错逐字：
 *
 *   `Response counter value 2 was lower than expected 2` → `Invalid credentials`
 *
 * 而"新设备"这条语义要求每条用例都把凭据**重新注入**一个干净的认证器；
 * 如果每次注入的都是 W1 那一刻的旧快照，计数器就从同一起点重新数 ——
 * 于是第一条登录用例绿、后面每一条都红（症状看着像"密码学坏了"，其实是测试假的问题）。
 *
 * ⇒ 每次登录完把**已经推进过的**那份快照读回来，下一次注入才有正确的起点。
 *    这也正是真实同步通行密钥（同一把钥匙在多台设备上）的行为。
 */
async function signInOnThisDevice(shell: Shell): Promise<VirtualAuthenticator> {
  const { page } = shell;
  const au = await shellAuthenticator(shell);
  if (journey.credential === null) throw new Error('旅程状态里没有通行密钥 —— W1 必须先跑');
  await injectCredential(au, journey.credential);
  await openShellApp(page);
  const dialog = await openAuthPanel(page);
  await loginWithPasskeyViaUi(page, dialog, journey.email);

  // 收回归属：认证器在断言时已经推进过计数器，取回来供下一台"设备"用。
  const latest = await readCredentials(au);
  if (latest.length === 1) journey.credential = latest[0]!;
  return au;
}

/** 证据落固定路径（AGENTS.md §6.2 规定一），图必须人看。 */
const shot = (n: number, name: string) => `test-results/windows-shell-${String(n)}-${name}.png`;

test('W1 未登录注册：头像菜单 → 登录/注册 → 用通行密钥注册出一个全新账号', async ({
  shell,
  request,
}) => {
  await ensureServer(request);
  journey.email = freshEmail();
  const { page } = shell;

  await openShellApp(page);
  const au = await shellAuthenticator(shell);

  // 里程碑截图（先落图，再断言）。
  await page.screenshot({ path: shot(1, 'signed-out') });

  const dialog = await openAuthPanel(page);

  await dialog.locator('input[type="url"]').fill(SERVER);
  await dialog.locator('input[type="email"]').fill(journey.email);
  // 面板里唯一的 checkbox 就是服务条款。
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: '用通行密钥注册' }).click();

  // TEST_MODE 自动验证 ⇒ 界面显示的是"注册申请已提交…"那段文案。
  await expect(authStatus(dialog)).toContainText('注册申请已提交');

  // 判据本体：虚拟认证器里**真的多了一把凭据**（真 WebAuthn，不是 stub）。
  const creds = await readCredentials(au);
  expect(creds.length, '注册应当在本机产生一把通行密钥').toBe(1);
  journey.credential = creds[0]!;

  await page.screenshot({ path: shot(2, 'registered') });

  // 注册 ≠ 登录：此刻还没有任何令牌落盘。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '注册（未登录）不得写入任何凭据').toBeNull();
});

test('W2 登录：同一把通行密钥拿到令牌，身份区出现邮箱且凭据落盘', async ({
  shell,
  request,
}) => {
  await ensureServer(request);
  const { page } = shell;

  await signInOnThisDevice(shell);

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

  await page.screenshot({ path: shot(3, 'signed-in') });
});

test('W3 数据上行：登录后建任务、补口令同步，服务端必须真的收到 op', async ({
  shell,
  request,
}) => {
  await ensureServer(request);
  const { page } = shell;

  await signInOnThisDevice(shell);

  journey.taskTitle = `win-shell-task-${Date.now()}`;
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
  expect(
    ops,
    `服务端必须存有该账号的 op（界面已报"已同步"），实际 ${String(ops)} 条`,
  ).toBeGreaterThanOrEqual(1);

  await page.screenshot({ path: shot(4, 'synced') });
});

test('W4 新设备恢复：重置设备后登录同账号，那条任务只能来自服务端', async ({
  shell,
  request,
}) => {
  await ensureServer(request);
  if (journey.taskTitle === '') throw new Error('W3 必须先跑（本用例依赖它上传的任务）');
  const { page } = shell;

  // 🔴 `shell` fixture 已经重置过设备并**断言**本地没有任务行 ⇒ 这台"新设备"
  //    关于那条任务没有任何本地来源。所以下面能看到它，唯一解释是服务端。
  await signInOnThisDevice(shell);
  await setE2eePasswordAndSync(page);
  await expect(statusBar(page)).toContainText('已同步');

  await expect(
    page.locator('[data-testid^="task-item-"]').filter({ hasText: journey.taskTitle }),
    '新设备上必须能看到那条任务 —— 它只可能来自服务端',
  ).toBeVisible();

  await page.screenshot({ path: shot(5, 'second-device') });
});

test('W5 退出登录：落盘凭据被清掉，身份入口翻回未登录形态', async ({ shell, request }) => {
  await ensureServer(request);
  const { page } = shell;

  await signInOnThisDevice(shell);

  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-email')).toBeVisible();

  await page.getByTestId('account-menu-signout').click();

  // 未登录形态翻回来：身份区消失、登录/注册回到第一项、退出登录语义上不存在。
  await expect(page.getByTestId('account-menu-email')).toHaveCount(0);

  /*
   * 🔴 **退出登录会把菜单收起来**（身份动作做完了），所以要看"未登录形态"
   * 必须再点一次头像把它重新打开。
   *
   * 直接去查 `account-menu-panel` 会一直等一个**不存在**的元素，
   * 报错是 `toHaveAttribute ... element(s) not found` ——
   * 读起来像"退出登录没生效"，其实菜单只是关了（2026-09-30 实测 W5 就是这么红的）。
   * 这也正是用户真实要做的动作：退出后想确认入口回来了，得再点一下头像。
   */
  await page.getByTestId('account-menu-avatar').click();
  await expect(page.getByTestId('account-menu-panel')).toBeVisible();
  const items = page.getByTestId('account-menu-panel').getByRole('menuitem');
  await expect(items.first()).toHaveAttribute('data-testid', 'sync-signin-entry');
  await expect(page.getByTestId('account-menu-signout')).toHaveCount(0);

  // 🔴 只清内存不够：落盘的那份必须也没了，否则刷新一次令牌就"活"回来。
  const stored = await page.evaluate(() =>
    window.localStorage.getItem('heyta.sync.credentials'),
  );
  expect(stored, '退出登录必须清掉落盘凭据').toBeNull();

  await page.screenshot({ path: shot(6, 'signed-out-again') });
});

test('W6 反向：服务端地址错了，界面必须说出失败而不是假装成功', async ({ shell, request }) => {
  await ensureServer(request);
  const { page } = shell;

  await openShellApp(page);
  await shellAuthenticator(shell);
  const dialog = await openAuthPanel(page);

  // 127.0.0.1:9 （discard 端口）上没有服务端 —— 注册必须失败且**可见**。
  await dialog.locator('input[type="url"]').fill('http://127.0.0.1:9');
  await dialog.locator('input[type="email"]').fill(freshEmail());
  await dialog.getByRole('checkbox').check();
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

  await page.screenshot({ path: shot(7, 'failure-visible') });
});
