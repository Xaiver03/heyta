/**
 * 真实浏览器用户旅程的公共步骤。
 * ==================================
 *
 * 这个文件里**没有一处 mock**：所有动作都是真的点击、真的输入、真的渲染，
 * 判定"真的发出了模型请求"靠读假端点的 `GET /__requests`
 * （见 `../stub-provider.mjs` 的文件头）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 配置端点为什么走这一串点击
 *
 * 出厂配置是**四道闸全关 + 零端点 + 零路由**（见 `aiStore.ts` 的
 * `defaultAiSettings()`）。所以任何一个功能要能用，用户必须自己在
 * 设置界面里走完这串动作。这些步骤与 jsdom 版旅程
 * （`apps/web/tests/journey-ai-memory.integration.spec.tsx` 的
 * `configureAiThroughUi`）**逐字对应**，只是换成真浏览器 API。
 *
 * ## 🔴 selector 全部来自源码，不是猜的
 *
 * - 开关 / 能力 / 密钥：`apps/web/src/features/settings/AiSettings.tsx`
 * - 功能路由 chip：同上，`data-testid="feature-<feature>"` 那一行里的按钮
 * - 各功能的入口与面板：`apps/web/src/features/ai/Ai*.tsx`
 *
 * ## ⚠️ 回环端点不需要"授权数据出境"
 *
 * 假端点在 `127.0.0.1`，而 `classifyDestination()` 把回环地址判为 `none`
 * （`packages/ai/src/supply.ts`）—— 也就是"数据不出设备"，于是
 * `consent-<feature>` 那一块**根本不会渲染**。helper 里做了兼容：
 * 出现了才点。这也意味着**远端授权链路在本套件里验不到**，见测试报告。
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { installMissingProducerShims } from './shims';

/** 假端点的来源（与 `playwright.config.ts` 的 webServer 端口一致）。 */
export const STUB_ORIGIN = 'http://127.0.0.1:4319';

/** 填进"地址"输入框的值。OpenAI 兼容 base，provider 会拼 `/chat/completions`。 */
export const STUB_ENDPOINT = `${STUB_ORIGIN}/v1`;

/** 填进"模型"输入框的值。假端点不校验模型名，只要求非空。 */
export const STUB_MODEL = 'stub-model';

/** 能力词表（与 `AiCapability` 一致）。 */
export const CAP_STRUCTURED_OUTPUT = 'structured_output';
export const CAP_LONG_CONTEXT = 'long_context';

export interface StubCall {
  readonly feature: string;
  readonly systemHead: string;
  /**
   * 🔴 只有对话助手那条旅程用得上：**这一次请求里有没有 `role:'tool'` 的结果**。
   *
   * 它是"多步循环真的把观察回送给了模型"的浏览器级证据。界面上写着
   * "用了 1 步工具"而请求体里什么都没有 —— 只有这个字段能区分这两种情况。
   */
  readonly hasToolResult?: boolean;
  /** 这一次请求里带着几条工具结果（`role:'tool'` 的消息数）。 */
  readonly toolStep?: number;
}

export interface StubLog {
  readonly count: number;
  readonly calls: readonly StubCall[];
}

/**
 * 清零假端点的调用计数。
 *
 * 🔴 **每条用例开头都必须调** —— 计数存在假端点进程里，而那个进程
 * 整个测试运行只启动一次，所以它是**跨用例共享**的。
 */
export async function resetStub(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${STUB_ORIGIN}/__reset`);
  expect(res.ok(), '假端点的 /__reset 应该可用').toBe(true);
}

export async function stubLog(request: APIRequestContext): Promise<StubLog> {
  const res = await request.get(`${STUB_ORIGIN}/__requests`);
  expect(res.ok(), '假端点的 /__requests 应该可用').toBe(true);
  return (await res.json()) as StubLog;
}

/** 轮询等到假端点累计收到 n 次调用，并返回那一刻的调用列表。 */
export async function waitForStubCalls(
  request: APIRequestContext,
  n: number,
): Promise<StubLog> {
  await expect
    .poll(async () => (await stubLog(request)).count, {
      message: `假端点应该累计收到 ${String(n)} 次调用`,
    })
    .toBe(n);
  return stubLog(request);
}

/** 断言假端点**一次调用都没收到**。用于"不该发请求"的反向旅程。 */
export async function expectNoStubCall(request: APIRequestContext): Promise<void> {
  const log = await stubLog(request);
  expect(
    log.count,
    `不应该发出任何模型请求，实际收到：${JSON.stringify(log.calls)}`,
  ).toBe(0);
}

/** 断言假端点累计收到 n 次调用（不多不少）。 */
export async function expectStubCount(
  request: APIRequestContext,
  n: number,
): Promise<void> {
  const log = await stubLog(request);
  expect(
    log.count,
    `假端点应该累计收到 ${String(n)} 次调用，实际：${JSON.stringify(log.calls)}`,
  ).toBe(n);
}

/**
 * 打开真应用，并等到输入框真的可见（白屏不算通过）。
 *
 * 🔴 先装**缺失生产者的垫片**（见 `shims.ts`）：这一支上有三个静态导入
 * 指向尚未落地的导出，一个名字不存在就整张模块图不求值 —— 症状是
 * `<body>` 全空、所有用例在"等添加任务的输入框"那一刻超时。
 * 垫片只满足"名字存在"，**一调用就抛**；生产者落地后它自动失效。
 */
/**
 * 把**全部功能模块**打开（写进设备本地偏好，`shell/modules.ts` 读它）。
 *
 * 🔴 为什么 e2e 默认走"全功能"配置：
 * 2026-09-29 加了「功能模块」开关，**番茄钟/成长/便签默认是关的、不进 DOM**。
 * 而这一套 e2e 的主线是"**每个视图都渲染得出来、且不白屏**" ——
 * 它需要所有视图都在。逐个用例去设置页点开关会把每条测试都变成交互脚本，
 * 而这里要验的是**视图本身**，不是开关。
 *
 * ⚠️ 所以「默认只有 6 个」这件事**必须由另一条专门的用例钉住**
 *（`motivation.spec.ts` 里那条"默认 rail"），否则它会在这套"全功能"配置下**永远测不到**。
 */
export async function enableAllModules(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // 存的是**显式覆盖**（见 modules.ts 的 `saveEnabledModules`）。
    window.localStorage.setItem(
      'heyta.shell.modules',
      JSON.stringify({
        quadrant: true,
        habits: true,
        timeline: true,
        focus: true,
        growth: true,
        notes: true,
      }),
    );
  });
}

/**
 * 首启隐私同意面板的真实出路。
 *
 * 🔴 **为什么这件事必须住在 `openApp` 里，而不是每条用例自己写一遍**：
 * 面板（`apps/web/src/features/privacy/PrivacyConsentSheet.tsx`）以 `role="presentation"`
 * 的遮罩盖住整棵 `main.ht-main`，而它的渲染条件是 `shouldAskOnFirstLaunch()`
 * = `privacyConsent.undecided()` —— Playwright 每条用例都是**全新的浏览器上下文**，
 * 于是每一轮启动都是"没问过的设备"。不做完这一步，后面**任何一次点击**都会
 * 卡在 actionability 上直到测试超时，而症状写的是
 * "`<div role="presentation">…` intercepts pointer events"，
 * 看起来像界面坏了（2026-10-02 实测：`pnpm verify:legal-links` 五条全部 120 秒红在这一句）。
 *
 * ⚠️ 这里**真点按钮**，不往 `localStorage` 塞记录：
 * 塞记录要把 `{decision, decidedAt}` 的形状抄一份到测试里，而那份抄件的唯一事实源在
 * `packages/app-host/src/privacy-consent.ts`（抄件一定会漂）；更坏的是形状一漂移，
 * 闸门按 fail-closed 判"没同意"，遮罩照旧，测试就退化成"永远在等一个不会来的点击"。
 * 点按钮只依赖 testID —— 那是界面自己的契约，`privacy-consent-zero-egress.spec.ts`
 * 也在断言它存在。
 *
 * 🔴 默认取 **`local-only`（最小承诺）**，而不是"顺手全同意"：
 * 这一套件的绝大多数判据只看本机界面，不碰网络；让共享入口默认替用户同意，
 * 等于把"我们尊重这个决定"变成"我们其实不在乎"——正是 `privacy-consent.ts`
 * 文件头列为 fail-closed 的那一侧。需要出门的旅程（假端点收调用、管理台拉数据、
 * 真服务端同步）**在自己的用例里显式传 `accepted`**，于是"这条旅程要出门"
 * 是一行写在调用点上的事实，而不是共享层里的默认值。
 *
 * ⚠️ **必须"等"它，不能"看一眼在不在"**（2026-10-02 实测）：面板是挂载之后的
 * `useEffect` 打开的，比 `goto` 的 load 事件晚。第一版这里写的是
 * `if (!(await dialog.isVisible())) return;` —— 那条**恒为假**，于是三条
 * `account-menu` 用例照旧红在 `div[role="presentation"] … intercepts pointer events`，
 * 而失败截图里面板明明白白开着。探针跑在了挂载前面（§7 元规则 1）。
 *
 * ⚠️ 代价：已经做完决定的上下文（同一浏览器里第二次 `openApp`）要等满这段
 * 超时才继续。5 秒 × 少数几条，比"面板出现得慢一点就整条套件卡死"便宜。
 */
export async function decidePrivacyConsent(
  page: Page,
  decision: 'accepted' | 'local-only' = 'local-only',
): Promise<void> {
  const dialog = page.getByTestId('privacy-consent-dialog');
  const shown = await dialog
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return;
  await page
    .getByTestId(decision === 'accepted' ? 'privacy-consent-accept' : 'privacy-consent-local-only')
    .click();
  await expect(dialog, '作出决定之后，同意面板必须关掉').toHaveCount(0);
}

/**
 * 把界面钉在**中文**（写进本机的语言偏好 = 解析链的第 1 层）。
 *
 * 🔴 为什么这一句必须住在共享入口里：2026-10-01 的语言解析链把
 * "系统语言" 放进了第 3 层（`apps/web/src/lib/locale.ts`，产品拍板），于是
 * Playwright 默认的 `en-US` 浏览器语言**会决定界面语言**。而这套判据的
 * 定位符与断言全是中文（`添加任务` 的 placeholder、`登录 / 注册`、`退出登录`）。
 * 2026-10-02 实测：`account-menu.spec.ts` 三条全红，红在
 * `waiting for input[placeholder^="添加任务"]` **元素根本不存在** ——
 * 截图里应用渲染得好好的，只是整片是英文。症状长得像"界面坏了"，
 * 实际是**探针跟着浏览器语言漂**（§7 元规则 1）。
 *
 * ⚠️ 这不是"替用户伪造状态"：写 `heyta.locale` 就是产品里"用户明确选过中文"
 * 的那个状态（第 1 层，胜过 `?lang=` 与系统语言）。真正测语言协商的是
 * `language-first-launch.spec.ts`，它**不走** `openApp`。
 *
 * ⚠️ 键名是从 `locale.ts` 的 `STORAGE_KEY` 抄的（e2e 刻意不在根工作区内，
 * 引不到那个包）。抄件会漂，所以这里配了一条**会响的**判据：键一错，
 * 种子被忽略 → 界面变英文 → `openApp` 那句中文 placeholder 断言当场红，
 * 而不是让后面 20 条用例各自去猜"为什么找不到元素"。
 */
export async function pinChineseUi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('heyta.locale', 'zh-CN');
  });
}

/**
 * 给"补签"那道读侧闸一个**不需要补签**的应答（`GET /api/account/legal-consent`）。
 *
 * 🔴 凡是往 `localStorage['heyta.sync.credentials']` 塞了 `baseUrl` + `token` 的用例
 * 都需要它，与用例的主题无关：应用一启动就会问一次（`apps/web/src/main.tsx` 把它挂在
 * `createStartupNetwork` 里，排在 `startRealtime` 之前），而这个假服务端
 * （`../stub-provider.mjs`）**只实现了 `/v1/chat/completions`**，其余路径一律 404
 * （`stub-provider.mjs:139-143`）。于是 404 会落进每条用例都挂的那句
 * 「除已登记缺失外不该有非 2xx」，把真正的失败淹掉 —— 2026-10-02 实测一次红六条
 * （取证在 `BLOCKED.md` B12 / §7 第 117 条）。
 *
 * ⚠️ 应答体是**服务端那个 handler 的字段集**（`server/src/api.ts` GET `/account/legal-consent`：
 * `needsReconfirm` / `reason` / `currentVersion` / `recordedVersion`），不是随手编的：
 * 客户端 `parseLegalConsentStatus`（`packages/app-host/src/hosted-auth.ts:963`）逐字段
 * 校验且 `reason` 必须是闭集词表里的一个，字段少一个就整条判 `malformed-response`。
 * 这份抄件刻意**只住在这里一处**（调用点按 `inbox.spec.ts` 既有的说法：
 * "塞了凭据之后它就会发，所以要给这个假服务端补上"）。
 *
 * ⚠️ 它**只答读侧**。真要验补签面板与 POST 的是 `legal-reconfirm-gate.spec.ts`，
 * 它自己装了覆盖整个 `/api` 前缀的带状态路由（后注册的会遮蔽这里）。
 */
export async function stubLegalRecheck(page: Page, origin: string = STUB_ORIGIN): Promise<void> {
  await page.route(`${origin}/api/account/legal-consent**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        needsReconfirm: false,
        reason: 'current',
        currentVersion: null,
        recordedVersion: null,
      }),
    });
  });
}

/**
 * 打开应用。
 *
 * @param path 打开哪个路径 —— 默认 `/`（应用根）。
 *   桌面壳的反向授权要用 `/?auth=desktop&state=…`（ADR-0039 §2.3），
 *   而那一步**必须**在应用启动时就在 URL 里，所以它是一个参数而不是"之后再点"。
 * @param consent 首启隐私闸门怎么答（见 {@link decidePrivacyConsent}）。
 *   默认 `local-only`；**这条旅程要不要出门**只有调用点知道，所以它是个参数，
 *   不是共享层里的默认值。
 *
 * ⚠️ 顺序是**先等界面、再关面板**：同意面板由挂载后的 effect 打开，
 * 反过来写会让这里等的那个元素被遮罩挡住（判据本身不受影响，
 * 但后面的点击会红成"元素点不动"而不是"面板没关"）。
 */
export async function openApp(
  page: Page,
  path = '/',
  consent: 'accepted' | 'local-only' = 'local-only',
): Promise<void> {
  await enableAllModules(page);
  await pinChineseUi(page);
  await installMissingProducerShims(page);
  await page.goto(path);
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await decidePrivacyConsent(page, consent);
}

/** 切换顶部视图 tab。 */
/**
 * 🔴 「设置」**不是** rail 上的 tab —— 它收在**头像菜单**里（2026-09-29）。
 * 所以它必须单独一条路：点头像 → 点菜单里的「设置」。
 */
export async function openSettingsView(page: Page): Promise<void> {
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await expect(page.locator('.ht-header__title').first()).toHaveText('设置');
  await waitForOverlaySettled(page, 'settings-sheet');
}

/**
 * 等**整屏浮层的入场动画落位**再返回。
 *
 * 为什么这是判据而不是等待技巧：`.ht-sheet` 的 `background` 是
 * `color-mix(… 95%, transparent)` —— 它**故意**让下层视图透出来（IA：设置是浮层不是路由）。
 * 而入场动画 `ht-sheet-in` 把**整块**的 `opacity` 从 0 跑到 1，时长 `--ht-duration-normal`。
 * 于是"点完设置立刻截图"拍到的是**动画中途**：下层以接近同等的浓度叠上来，
 * 看起来像"文字压文字的排版事故"，而它既不是事故也不是稳态。
 * 第一轮的 `3-settings-tier.png` 就是这样拍坏的 —— 人已看图，但看的是过渡帧。
 *
 * ⚠️ 判据取的是**元素自己的动画**（不是 `document.getAnimations()`）：后者会把
 * 页面上其它在跑的动画算进来，那会让这一条永远等不完。
 * `prefers-reduced-motion` 下 `.ht-sheet { animation: none }` ⇒ 集合为空、立刻返回，
 * 所以它不是"睡 300ms"那种假等待。
 */
export async function waitForOverlaySettled(page: Page, testId: string): Promise<void> {
  const overlay = page.getByTestId(testId);
  await expect(overlay, `浮层 ${testId} 必须真的在 DOM 里`).toHaveCount(1);
  await overlay.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

/**
 * 收掉**当前开着**的整屏浮层（搜索 scrim / 设置 sheet），若没开就什么都不做。
 *
 * 判据来自 `apps/web/src/App.tsx:1553`：Esc 在**捕获阶段**监听，是浮层的真实退出口
 * （搜索 scrim 的 `onClick` 也关，但按 Esc 不依赖坐标命中，最稳）。
 * ⚠️ 只对**真的开着**的那个浮层按 —— 在普通视图里凭空发一个 Esc 会去触发
 * 别的键位处理（见上面注释里"别在普通视图里凭空发一个 Esc"）。
 */
async function dismissFullBleedOverlay(page: Page): Promise<void> {
  for (const testId of ['search-overlay-surface', 'settings-sheet']) {
    if (await page.getByTestId(testId).isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(page.getByTestId(testId)).toHaveCount(0);
    }
  }
}

export async function switchView(
  page: Page,
  /**
   * 🔴 **这份联合类型必须与 `apps/web/src/App.tsx` 的 `VIEW_TABS` 同步。**
   *
   * 它曾经停在 **7 个**标签（没有 `'便签'` / `'回收站'`），而 Playwright 走 esbuild
   * **只转译、不做类型检查** ⇒ 传 `'便签'` 运行时照跑、类型上却非法，
   * **没有任何东西会因此变红**。于是"新增一个视图 tab"只改了产品、没改 e2e ——
   * 直到有人真的跑 `pnpm check`（而它此前长期没人跑）。
   *
   * ⚠️ **加视图时要一起改的四处清单**（漏一处就会有静默过期）：
   *   1. `apps/web/src/App.tsx`：`VIEW_TABS` / `ViewKey`
   *      （标题**不用登记了** —— R9 把默认改成"标题跟视图走"，只有任务视图读
   *       `store.filter`。原来那张 `VIEW_TITLED_BY_TAB` 白名单就是漏登记日历造成的
   *       缺陷本身，已删）
   *   2. **这里**
   *   3. `e2e/tests/motivation.spec.ts`：`TABS` / `TITLED` / `CARD_ON` / `VIEW_ANCHOR`
   *      （`CARD_OFF` 不用改 —— 它由 `TABS` 算出来，新视图默认落进"不该有进度卡"那一侧）
   *   4. `apps/landing/src/mockup/app-shell-shape.ts`：`SHELL_VIEW_TABS`
   *      （那一处有**实时对账判据**，漏了会红 —— 前三处都不会）
   */
  label:
    | '任务'
    | '日历'
    | '四象限'
    | '习惯'
    | '时间线'
    | '番茄钟'
    | '成长'
    | '便签'
    | '搜索'
    | '回收站'
    | '设置',
): Promise<void> {
  // 「设置」不在 tablist 里（见 `openSettingsView`）。
  if (label === '设置') {
    await dismissFullBleedOverlay(page);
    await openSettingsView(page);
    return;
  }
  /**
   * 🔴 切视图**前**先收掉可能盖住 rail 的整屏浮层（2026-10-01 补）。
   *
   * `bcb68354` 把搜索 scrim 从 `absolute`（只盖内容区）改成 `position: fixed; inset: 0`
   * （整屏，为修"⌘K 把页面弹回顶部"）。副作用：**rail 也在 scrim 底下**，于是
   * `motivation.spec.ts` 那两条"走一遍全部视图"的循环，一旦轮到「搜索」把浮层打开，
   * 下一次 `getByRole('tab').click()` 就命中 scrim 而不是 tab —— 症状是 Playwright
   * 卡在 "…intercepts pointer events" 直到 90s 超时，长得像"下一个视图打不开"。
   *
   * 真实用户不会这样导航：他要么点 scrim（关浮层）要么按 Esc，**再**去点别的视图。
   * 所以这里按 Esc 收掉浮层是**还原人的操作顺序**，不是绕过产品缺陷。
   * 只在这两个整屏浮层真的开着时才按 —— 别在普通视图里凭空发一个 Esc。
   */
  await dismissFullBleedOverlay(page);
  await page.getByRole('tab', { name: label }).click();
}

/** 通过输入框回车建一条任务（走 `CaptureComposer`，真 op-log）。 */
export async function addTask(page: Page, title: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(title);
  await composer.press('Enter');
  await expect(rowFor(page, title)).toBeVisible();
}

/**
 * 按标题找到任务行。
 *
 * ⚠️ 用**标题**而不是 taskId 定位：真浏览器里拿不到 id（也不该去拿内部状态），
 * 而"用户看得见的那一行"本来就是断言该挂的地方。
 *
 * 🔴 选择器来自共享 `TaskList` 的 testID，不再是 web 手写的 `.ht-task`
 * （那一族 CSS 已随 M3 第一刀删除）。`task-item-*` 是**整行**，包含行尾
 * 插槽（备注 / 清单标签 / 删除）—— 用 `task-row-*` 会只匹配到标题体，
 * 那些控件就不在这一行里了。
 *
 * 🔴🔴 **不能再用 `filter({ hasText: title })`**（2026-09-29 实测踩到）：
 * 行尾插槽里现在有**「子任务父级」选择器**，它的 `<option>` 会把**别的任务的
 * 标题**列出来。于是 `hasText: '修登录页错位'` 会同时命中「写周报」那一行
 * （它的 option 里就有这四个字），Playwright 判 strict mode violation ——
 * `ai-prioritize` 因此红了，而**产品是对的**（那一行确实不是它）。
 *
 * ⇒ 改用**这一行自己的完成勾选框**定位：可访问名是 `完成：<标题>` /
 * `取消完成：<标题>`（`web.shell.tasks.complete` / `uncomplete`），
 * 它只属于本行，且**不随行尾插槽增减而漂移**。
 * 两种前缀都认：已完成分组里的任务标签是「取消完成：」。
 */
export function rowFor(page: Page, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return page.locator('[data-testid^="task-item-"]').filter({
    has: page.getByRole('checkbox', { name: new RegExp(`^(?:完成|取消完成)：${escaped}$`) }),
  });
}

/** 任务行右侧的元信息区（清单归属 / 截止时间 / 优先级徽标）。 */
export function metaFor(page: Page, title: string) {
  return rowFor(page, title).locator('[data-testid="task-meta"]');
}

/**
 * 元信息区里**每一个徽章**的文字，按 DOM 顺序（一个徽章 = 一个子节点）。
 *
 * 🔴 为什么不再直接读 `metaFor(...)` 的文本：行内常驻**清单归属**之后，那一段
 * 必然是「收集箱高优先级」这样连成一串的（`gap` 是布局间距，不产生空格）。
 * 于是 `toContainText` 会因拼接而"看起来通过"，而 `not.toContainText('P')`
 * 这种旧的否定判据会因新文案里根本没有 `P` 而**永远通过** ——
 * 一条永远通过的判据比没有判据更糟。逐徽章比才回答"这一槽里到底有什么"。
 *
 * ⚠️ 它返回的是**已经取到的快照**，没有 locator 的自动重试 —— 用它做判据要包在
 * `expect.poll(...)` 里，否则"界面还没重渲染"会变成一条假红。
 */
export async function metaBadgeTexts(page: Page, title: string): Promise<string[]> {
  const texts = await metaFor(page, title)
    .locator('> *')
    .allTextContents();
  return texts.map((text) => text.trim());
}

export interface EndpointSetup {
  /** 要在该端点上勾选的能力（不勾 `long_context` 会让拆解永远没有候选）。 */
  readonly capabilities: readonly string[];
  /** 要把该端点路由给哪些功能（`capture` / `breakdown` / `prioritize` / `duration-estimate`）。 */
  readonly features: readonly string[];
  readonly endpoint?: string;
  readonly model?: string;
  readonly allowRemote?: boolean;
}

/**
 * 在**设置界面**里把 AI 端点配起来：开闸 → 加自定义端点 → 填地址/模型/密钥
 * → 声明能力 → 指定功能路由 →（远端才需要）授权。
 *
 * 🔴 顺序有讲究：先开 `#ai-enabled`，端点那一整段才会渲染出来。
 */
export async function configureEndpoint(page: Page, setup: EndpointSetup): Promise<void> {
  await switchView(page, '设置');
  await expect(page.locator('[data-testid="ai-settings"]')).toBeVisible();

  // ── 闸 1、闸 2 ──────────────────────────────────────────────────────
  await page.locator('#ai-enabled').check();
  await expect(page.locator('#ai-allow-remote')).toBeVisible();
  if (setup.allowRemote ?? true) {
    await page.locator('#ai-allow-remote').check();
  }

  // ── 加一个空白自定义端点 ────────────────────────────────────────────
  // ⚠️ 刻意**不校验地址**（见 AiSettings 的 addCustomEndpoint 注释）：
  // 先给用户一个空输入框，而不是"点了没反应"。
  await page.locator('[data-testid="add-custom-endpoint"]').click();
  const row = page.locator('[data-testid="endpoint-custom-1"]');
  await expect(row).toBeVisible();

  await row.locator('[aria-label$="的地址"]').fill(setup.endpoint ?? STUB_ENDPOINT);
  await row.locator('[aria-label$="的模型"]').fill(setup.model ?? STUB_MODEL);

  // 密钥只进内存（本会话），必须显式点"记住"。
  // 假端点不校验密钥，但"输入框存在 + 能记住"本身就是一条要验的接线。
  await row.locator('[aria-label$="的密钥"]').fill('stub-key');
  await row.getByRole('button', { name: '记住（本次会话）' }).click();
  await expect(row.locator('[aria-label$="的密钥"]')).toHaveAttribute(
    'placeholder',
    '已在本次会话中',
  );

  // ── 能力声明（不勾就没有，见 AiSettings 文件头）──────────────────────
  for (const capability of setup.capabilities) {
    await row.locator(`[aria-label$="的能力 ${capability}"]`).check();
  }

  // ── 逐功能路由 ──────────────────────────────────────────────────────
  for (const feature of setup.features) {
    const featureRow = page.locator(`[data-testid="feature-${feature}"]`);
    await featureRow.locator('button', { hasText: '自定义端点' }).click();

    // 回环端点目的地是 `none` → 不要求授权，这一块不会渲染。
    const consent = page.locator(`[data-testid="consent-${feature}"]`);
    if ((await consent.count()) > 0) {
      await consent.getByRole('button', { name: '授权' }).click();
    }
  }
}

/** 配好之后再把总开关关掉 —— 用来验"网络层闸门真的拦住了"。 */
export async function disableAiMasterSwitch(page: Page): Promise<void> {
  await switchView(page, '设置');
  await page.locator('#ai-enabled').uncheck();
  // 关掉之后端点那段应当整体消失（界面上不残留"可用"的错觉）。
  await expect(page.locator('#ai-allow-remote')).toHaveCount(0);
}
