import { expect, test } from '@playwright/test';
import { decidePrivacyConsent, openApp, pinChineseUi, switchView } from './helpers';
import { installMissingProducerShims } from './shims';

/**
 * 激励体系的**真浏览器**验收。
 *
 * 与 `smoke.spec.ts` 的分工：那条证明"链路本身是通的"（环境问题还是功能问题），
 * 这条验的是**激励体系自己的设计契约** —— 所以每一条都必须是**能失败**的，
 * 断言里写的都是我们从源码里刻意选定的判据，不是"页面能打开"。
 *
 * ## 判据来自哪些源码
 *
 * - 11 个标签与顺序：`apps/web/src/App.tsx` 的 `VIEW_TABS`
 * - 哪些视图的居中标题 === 标签：下面本文件的 `TITLED`。
 *   🔴 标题的**默认**就是跟视图走（R9 起）：`App.tsx` 的 `title` 只在任务视图
 *   （和四象限页真的落在某个象限时）才读 `store.filter`。原来那 7 个是靠一张
 *   `VIEW_TITLED_BY_TAB` 白名单挑出来的，**漏登记日历就是 R9 那个缺陷本身**，
 *   白名单已删 —— 所以下面这张表现在是"断言的覆盖面"，不再是"行为的开关"。
 * - 周复盘 / 年度视图 / 中性差值：`apps/web/src/features/motivation/GrowthView.tsx`
 *
 * ## 🔴 为什么这里还留着一条"进度卡不许出现"
 *
 * `[data-testid="today-progress"]` 曾经是宿主 `TodayProgressBanner.tsx:45` 注入的，
 * 2026-10-01 产品负责人看图后拍板**彻底删除**（台账 R6）。
 *
 * 这个判据在一天之内换过三次方向，全部是刻意的，所以值得留一行账：
 *
 * - 09-29 的方案：常驻「做事」的视图，但**故意**排除成长页 —— 那一页讲的是更长尺度，
 *   再顶一条"今天 3/5"会把"历史"重新压回"今天"，恰好抵消那个页面存在的意义。
 * - 09-30 拍板（commit `02fef9a7`）：**只在任务视图**。理由更硬 ——
 *   "0/0 今天还没有安排"出现在日历/习惯/番茄钟/便签上是纯噪音。
 * - 10-01 拍板：**任务视图也没有**。前两次都在缩小它，第三次发现缩不动了 ——
 *   问题不是"出现在哪几屏"，是"它是一屏的开头有一块不属于任务的板"。
 *   对照滴答清单：今日完成数**从来不是一个面板**，而是侧栏每行右侧的计数、
 *   分组头的计数、行右侧的元信息这三个位置。
 *
 * ⚠️ 判据**不跟着组件一起删**，是因为这个形状被抹掉时什么都不报错：
 * 前两次改版它就红过一次（那次是产品对、契约过期）。把期望改成 0 之后，
 * 谁把它加回做事视图，这条会立刻指出来。
 *
 * ⚠️ 共享的 `TodayProgressCard` 本身**还在**（成长页 `GrowthBoard` 的 `showToday` 段
 * 仍在渲染它，只是不带 testID）。这里判的是"做事视图不许有它"，不是"这个组件不存在"。
 */

// ⚠️ 这张表的**顺序**必须与 `apps/web/src/App.tsx` 的 `VIEW_TABS` 逐字一致。
// 漂移过一次：`trash`（回收站）加进 VIEW_TABS 之后这里没跟上，两个用例红了
// 很久没人发现 —— 因为 e2e 不在 `pnpm check` 的主路径上。
// 加视图时，**先改这里**，再改 App.tsx。
// 🔴 2026-09-29：视图切换从**顶栏一行**搬进了**侧栏**并**分成两组**
//（`dida-view-unification.md` §4.4：顶栏在 1280px 下只能完整显示 5/8）。
// 顺序随之改变：主视图（任务/四象限/习惯/时间线）在前，低频的（番茄钟/成长/便签/回收站/设置）在后。
// ⚠️ rail 上 11 个入口、tablist 里 **10 个** —— 「设置」收进头像菜单，不是 tab。
// `smoke.spec.ts:27` 断言的同样是 `toHaveCount(10)`，两处必须一起改。
// 🔴 「搜索」排在**上段最后一个**（滴答的 rail 就是这样）：
// 它常驻不给关，位置在全部视图之后、下段工具之前。
const TABS = ['任务', '日历', '四象限', '习惯', '时间线', '番茄钟', '成长', '便签', '搜索', '回收站', '设置'] as const;
type Tab = (typeof TABS)[number];

/**
 * 居中标题 === 标签本身的视图。
 *
 * 🔴 R9 起这张表**只缺「任务」一项**：任务视图的标题是清单/筛选名（「收集箱」、
 * 「重要不紧急」、用户自己的清单名），那是它该有的样子。其余每个视图都必须由
 * 自己的 tab 命名 —— 日历以前不在这里，而它不在的原因**就是**那个缺陷
 * （标题回落到读上一个视图残留的 filter）。
 */
const TITLED = [
  '日历',
  '四象限',
  '习惯',
  '番茄钟',
  '时间线',
  '成长',
  '便签',
  '搜索',
  '回收站',
  '设置',
] as const satisfies readonly Tab[];

/**
 * 今日进度卡应当出现的视图 —— **2026-10-01 起为空**（R6：产品负责人拍板彻底删除，
 * 见文件头那段"换过三次方向"的账）。
 *
 * 🔴 这张表**不删**：判据的形状是"算出来的"，加新视图的人只改 `TABS` 就会自动
 * 落进"不许有卡"那一侧。反过来，想让某个视图有卡必须显式往这里加一行 ——
 * 那就是一次看得见的改契约，而不是一次静默的重构。
 */
const CARD_ON: readonly Tab[] = [];

/**
 * 两个**浮层**：设置与搜索不换内容区（`contentView` 让下层视图继续透出），
 * 所以"这一屏有没有进度卡"取决于**从哪个视图打开的** —— 不能当普通视图断。
 *
 * 🔴 它们**也不能混进下面那条普通视图循环**（2026-10-01 实测）：浮层开着的时候
 * 会盖住 rail，Playwright 的 `locator.click()` 会一直卡在
 * "waiting for element to be visible, enabled and stable / … intercepts pointer events"
 * 直到 90s 超时 —— 症状长得像"下一个视图打不开"，而真原因是**上一轮的浮层没收掉**。
 * 所以它们单独一条循环，并且**每轮用 Esc 关掉再走下一轮**（见下面那条用例）。
 *
 * `surface` 是各浮层自己的根 testID，那条循环用它做**正向对照**。
 */
const OVERLAYS = [
  { tab: '设置', surface: 'settings-sheet' },
  { tab: '搜索', surface: 'search-overlay-surface' },
] as const satisfies readonly { tab: Tab; surface: string }[];

/**
 * 不该出现进度卡的视图 = 全部 − 有卡的 − 浮层，**算出来**而不是手抄。
 * 🔴 手抄那份正是它失效的方式：加视图的人只改了 `TABS`，新视图两边都没进，
 * 于是它**静默地不受任何判据约束**。算出来的话，新视图默认落进"不该有卡"这一侧，
 * 想让它有卡必须显式动 `CARD_ON` —— 那就是一次有意的改契约。
 */
const OVERLAY_TABS: Tab[] = OVERLAYS.map((overlay) => overlay.tab);
const CARD_OFF: readonly Tab[] = TABS.filter(
  (tab) => !CARD_ON.includes(tab) && !OVERLAY_TABS.includes(tab),
);

/**
 * 已登记的已知缺失：仓库**从来没有** favicon
 * （源 `apps/web/index.html` 无引用、无 `public/`、git 里一个 `.ico` 都没有、main 同样如此）。
 *
 * 🔴 这里登记**具体路径**，而不是过滤 "404" 字样 ——
 * 后者会把将来真正坏掉的资源一起藏掉（v1 的自检脚本正是这么写的，已改）。
 */
const KNOWN_MISSING = ['/favicon.ico'] as const;

test.describe('激励体系：真浏览器契约', () => {
  test('九个视图标签齐全，顺序与文案逐字一致（全功能配置）', async ({ page }) => {
    await openApp(page);

    const tabs = page.getByRole('tab');
    // 🔴 **10 而不是 11**：十一个入口里「设置」收在**头像菜单**（它是低频配置，
    // 不是"去哪看"），所以它不在 tablist 里。其余 10 个都在。
    await expect(tabs).toHaveCount(10);

    const labels = (await tabs.allTextContents()).map((t) => t.trim());
    expect(labels, '标签的顺序与文案都必须与 VIEW_TABS 逐字一致（少了「设置」）').toEqual([
      ...TABS.filter((t) => t !== '设置'),
    ]);
  });

  /**
   * 🔴 **默认 rail 只有 6 个** —— 这是 2026-09-29「功能模块」开关的核心承诺。
   *
   * ⚠️ 它**必须单独一条、且不走 `openApp`**：`openApp` 会打开全部模块，
   * 于是"默认几个"这件事在那套配置下**永远测不到**。
   * 这条用的是裸 `page.goto` —— 新装用户看到的就应该是这个。
   *
   * ⚠️ 但"不走共享入口"**不等于**"不修探针"：下面仍然要钉中文（那些标签是
   * 中文文案，浏览器默认 en-US 会让整片变英文）并做完首启隐私同意
   * （`role="presentation"` 的整屏遮罩）。这两件事都**不碰模块默认值**，
   * 所以"默认 7 个 tab"这条判据测的还是新装用户那一屏。
   */
  test('🔴 默认 rail 只有 7 个 tab（6 个视图 + 回收站）', async ({ page }) => {
    await installMissingProducerShims(page);
    await pinChineseUi(page);
    await page.goto('/');
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await decidePrivacyConsent(page);

    const labels = (await page.getByRole('tab').allTextContents()).map((t) => t.trim());
    // 默认：6 个视图（任务/日历/四象限/习惯/时间线/**搜索**）+ 1 个工具 tab（回收站）。
    // ⚠️ 「设置」在头像菜单里、「帮助」是动作（不在 tablist）—— 两个都不是 tab。
    expect(labels, '默认应当是 5 个视图 + 搜索 + 1 个工具').toEqual([
      '任务',
      '日历',
      '四象限',
      '习惯',
      '时间线',
      '搜索',
      '回收站',
    ]);

    // 反面：默认关掉的那三个**不该在 DOM 里**（不是"渲染了但看不见"）。
    for (const off of ['番茄钟', '成长', '便签']) {
      await expect(
        page.getByRole('tab', { name: off }),
        `${off} 默认是关的，不该出现在导航里`,
      ).toHaveCount(0);
    }
  });

  test('除任务视图外，每个视图的居中标题都等于标签本身（R9）', async ({ page }) => {
    await openApp(page);

    for (const tab of TITLED) {
      await switchView(page, tab);
      await expect(
        page.locator('.ht-header__title').first(),
        `${tab} 页的居中标题应当就是「${tab}」`,
      ).toHaveText(tab);
    }
  });

  test('🔴 今日进度卡在任何视图都不出现（2026-10-01 拍板删除，R6）', async ({ page }) => {
    await openApp(page);
    /**
     * 🔴 先钉**表本身**：`CARD_ON` 必须为空。
     * 这条断言不看界面，看的是"这个决定还成立吗"—— 有人想往回加一张卡，
     * 必须先让这一行红一次，而不是悄悄把 '任务' 塞回数组里让下面的循环放行。
     */
    expect(CARD_ON, '做事视图的进度卡已删除；要恢复请先读文件头那三次转向').toHaveLength(0);

    /**
     * 选择器**必须是共享组件的 testID**，不能再用 `section.ht-today`。
     *
     * `.ht-today` 是 web 手写的 CSS 类，随 M3 motivation 换装**已被删除**。
     * 注入 testID 的那个宿主接线（`TodayProgressBanner.tsx`）也随 R6 删除了 ——
     * 也就是说这个选择器现在**在任何视图都不该命中**。
     *
     * ⚠️ 教训：**换装共享组件时，e2e 里按 web 手写类名定位的断言会静默过期**
     * —— 单测与静态门禁都发现不了，只有真浏览器 e2e 会红。
     */
    const card = page.locator('[data-testid="today-progress"]');

    for (const tab of CARD_OFF) {
      await switchView(page, tab);
      await expect(card, `${tab} 不该显示今日进度卡`).toHaveCount(0);
    }

    /**
     * 浮层单独再走一遍，判的是**顺序**而不是结果：下层视图会透出，
     * 所以必须先站到一个别的视图上再打开浮层，否则这条测的是
     * "上一个视图是什么"。（反向那半 —— 下层视图必须继续透出 —— 由
     * `settings-exit.spec.ts` 钉。）
     *
     * 🔴 每轮先断言**浮层真的开了**（`overlay.surface`）再断"没有卡"：
     * 浮层没开时"卡数量是 0"会一样成立，那条判据就是在空转（§7 元规则二）。
     * 关掉走真实退出口（Esc，`App.tsx:1553` 的捕获阶段监听），并断言真的收了 ——
     * 不收就会把上一轮的浮层带进下一轮，撞上 `OVERLAYS` 注释里那条超时。
     */
    for (const overlay of OVERLAYS) {
      await switchView(page, '日历');
      await switchView(page, overlay.tab);
      const surface = page.getByTestId(overlay.surface);
      await expect(
        surface,
        `${overlay.tab} 浮层要真的打开，否则下面那句"没有卡"是在空转`,
      ).toBeVisible();
      await expect(
        card,
        `${overlay.tab} 是浮层，下层透出时也不该有今日进度卡`,
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(
        surface,
        `${overlay.tab} 必须收掉，否则下一轮点 rail 会被它拦住（实测超时形状）`,
      ).toHaveCount(0);
    }
  });

  test('成长页渲染周复盘与年度视图，差值中性、无负数', async ({ page }) => {
    await openApp(page);
    await switchView(page, '成长');

    // 🔴 `.ht-growth` 是 web 手写类，已随换装删除 —— 见 `:75` 的同一条注释。
    const growth = page.locator('[data-testid="growth-board"]');
    await expect(growth).toHaveCount(1);
    await expect(growth, '周复盘').toContainText('本周');
    await expect(growth, '年度视图').toContainText('这一年');
    await expect(growth, '差值只用中性表述（"还差"），不出现"比上周少"').toContainText('还差');
    await expect(growth, '最长/累计只增不减这条红线要在界面上说出来').toContainText('只增不减');

    // 🔴 先剥离 ISO 日期再断言 —— `2026-09-21` 里的 `-09` 不是负数。
    // （这一条踩过：自检脚本 v1 用裸的 `-\d` 把日期判成了负数。）
    const text = (await growth.textContent()) ?? '';
    const noDates = text.replace(/\d{4}-\d{2}-\d{2}/gu, '');
    expect(noDates, '剥离 ISO 日期后不该出现任何负数').not.toMatch(/-\d/u);
  });

  /**
   * 每个视图**自己的**根锚点。🔴 值全部来自组件源码里的 `testID` / `data-testid`，
   * 不是猜的 —— 见 `apps/web/src/features/<视图>/*` 与 `packages/ui/src/*`。
   *
   * 为什么不用"页面文字长度 > N"：那是**代理指标**。它 2026-09-30 实测红过一次 ——
   * 习惯页恰好 60 个字符（进度卡不再常驻后文字变少了），阈值没告诉我们任何
   * 界面事实：既没说它白屏，也没说它正常。换成"这一屏必须有自己的那块板"之后，
   * 红了就精确到**哪个视图的哪个组件没渲染**。
   *
   * ⚠️ 番茄钟用共享 `FocusPanel` **内层**的 `focus-ring`：`FocusTimer` 没给根节点
   * 传 testID，而那一圈是计时器本体的结构标记，比外层容器更精确。
   *
   * 🔴 任务的锚点**换过**：原先是 `today-progress`（那张常驻进度卡恰好是这一屏
   * 唯一无条件渲染的面）。2026-10-01 那张卡删掉之后，如果这里还指着它，
   * 这条白屏检测会**跟着组件一起消失**而没人注意到 —— 现在指向任务面板本体
   * `task-list`（空 inbox 时它是包着空态的那层容器，见 `App.tsx` 的 R6 注释）。
   */
  const VIEW_ANCHOR: Record<Tab, string> = {
    任务: 'task-list',
    日历: 'calendar-board',
    四象限: 'quadrant-board',
    习惯: 'habit-board',
    时间线: 'timeline-view',
    番茄钟: 'focus-ring',
    成长: 'growth-board',
    便签: 'notes-board',
    搜索: 'search-panel',
    回收站: 'trash-board',
    设置: 'settings-sheet',
  };

  test('每个视图都渲染出自己的那块板（白屏检测）', async ({ page }) => {
    await openApp(page);

    /**
     * 🔴 `Record<Tab, string>` 是这条判据**能失败**的一半：
     * 加视图而没给锚点 → 缺键；锚点写错 → 下面 `toHaveCount(1)` 红。
     * 顺带 `TABS` 少一列也会红（表里的键不在 `TABS` 里就不会被遍历到 ——
     * 所以显式对一次账，别让它悄悄漏）。
     */
    const anchored = Object.keys(VIEW_ANCHOR);
    expect(
      anchored.filter((k) => !(TABS as readonly string[]).includes(k)),
      '锚点表里有 TABS 之外的视图（那意味着有视图永远不会被走查）',
    ).toEqual([]);
    expect(
      TABS.filter((tab) => !anchored.includes(tab)),
      'TABS 里有视图没有根锚点（新视图必须同时登记它自己的板）',
    ).toEqual([]);

    for (const tab of TABS) {
      await switchView(page, tab);
      await expect(
        page.getByTestId(VIEW_ANCHOR[tab]),
        `${tab} 视图的根锚点 [data-testid="${VIEW_ANCHOR[tab]}"] 必须渲染出来`,
      ).toHaveCount(1);
    }
  });

  test('走一遍全部视图，控制台不出现意外 error', async ({ page }) => {
    const consoleErrors: string[] = [];
    const badResponses: string[] = [];
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e)}`));
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('response', (r) => {
      if (r.status() >= 400) badResponses.push(new URL(r.url()).pathname);
    });

    await openApp(page);
    for (const tab of TABS) await switchView(page, tab);

    const unexpected = badResponses.filter(
      (u) => !KNOWN_MISSING.some((k) => u === k),
    );
    expect(unexpected, `除已登记缺失外不该有非 2xx：${JSON.stringify(unexpected)}`).toEqual([]);

    // "Failed to load resource" 那类已由上面的 URL 断言精确覆盖，
    // 这里要的是**其余**控制台 error 为零（即真正的 JS 层报错）。
    const nonResource = consoleErrors.filter((t) => !/Failed to load resource/u.test(t));
    expect(nonResource, `不该有 JS 层报错：${JSON.stringify(nonResource)}`).toEqual([]);
  });
});