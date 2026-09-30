import { expect, test } from '@playwright/test';
import { openApp, switchView } from './helpers';
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
 * - 哪 7 个视图的居中标题 === 标签：同文件的 `VIEW_TITLED_BY_TAB`
 * - 进度卡的可见范围：同文件的 `{contentView === 'tasks' && <TodayProgressBanner />}`
 * - 周复盘 / 年度视图 / 中性差值：`apps/web/src/features/motivation/GrowthView.tsx`
 * - `[data-testid="today-progress"]`：共享 `packages/ui/src/motivation/TodayProgressCard.tsx`
 *   的 `testID`，由宿主 `TodayProgressBanner.tsx:45` 注入
 *
 * ## 🔴 为什么进度卡的可见范围值得一条用例
 *
 * 这条判据在一天之内**换过一次方向**，而两次都是刻意的：
 *
 * - 09-29 的方案：常驻「做事」的视图，但**故意**排除成长页 —— 那一页讲的是更长尺度，
 *   再顶一条"今天 3/5"会把"历史"重新压回"今天"，恰好抵消那个页面存在的意义。
 * - 09-30 拍板（commit `02fef9a7`）：**只在任务视图**。理由更硬 ——
 *   "0/0 今天还没有安排"出现在日历/习惯/番茄钟/便签上是纯噪音；
 *   "跨视图的同一件事"只说明它不该长四份，不说明它该到处出现。
 *
 * 值得钉住的从来不是**哪一个**范围，而是"某处故意不显示"这个形状本身：
 * **它最容易被后来的一次重构抹掉，而抹掉之后什么都不报错。**
 *
 * ⚠️ 这条用例正是那次改版的报警器 —— 它红了，产品是对的、契约过期了。
 * 但它在 `pnpm check` 的主路径上**跑不到**（e2e 要单独 `check:ai-e2e`），
 * 所以它红了约一天没人发现。**红了要读，不要先想"把它改绿"。**
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

/** 居中标题 === 标签本身的视图（其余视图的标题是清单/筛选名） */
const TITLED = ['习惯', '番茄钟', '时间线', '成长', '便签', '回收站', '设置'] as const satisfies readonly Tab[];

/** 今日进度卡应当出现的视图 —— 2026-09-30 起**只有任务**（`App.tsx` 的 `contentView === 'tasks'`）。 */
const CARD_ON: readonly Tab[] = ['任务'];

/**
 * 两个**浮层**：设置与搜索不换内容区（`contentView` 让下层视图继续透出），
 * 所以"这一屏有没有进度卡"取决于**从哪个视图打开的** —— 不能当普通视图断。
 * 下面单独一条用例按"下层不是任务"判它们。
 */
const OVERLAYS: readonly Tab[] = ['设置', '搜索'];

/**
 * 不该出现进度卡的视图 = 全部 − 有卡的 − 浮层，**算出来**而不是手抄。
 * 🔴 手抄那份正是这次失效的方式：加视图的人只改了 `TABS`，新视图两边都没进，
 * 于是它**静默地不受任何判据约束**。算出来的话，新视图默认落进"不该有卡"这一侧，
 * 想让它有卡必须显式动 `CARD_ON` —— 那就是一次有意的改契约。
 */
const CARD_OFF: readonly Tab[] = TABS.filter(
  (tab) => !CARD_ON.includes(tab) && !OVERLAYS.includes(tab),
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
   */
  test('🔴 默认 rail 只有 7 个 tab（6 个视图 + 回收站）', async ({ page }) => {
    await installMissingProducerShims(page);
    await page.goto('/');
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

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

  test('有居中标题的五个视图，标题等于标签本身', async ({ page }) => {
    await openApp(page);

    for (const tab of TITLED) {
      await switchView(page, tab);
      await expect(
        page.locator('.ht-header__title').first(),
        `${tab} 页的居中标题应当就是「${tab}」`,
      ).toHaveText(tab);
    }
  });

  test('🔴 今日进度卡只在任务视图；其余视图（含两个浮层）都没有', async ({ page }) => {
    await openApp(page);
    /**
     * 🔴 选择器**必须是共享组件的 testID**，不能再用 `section.ht-today`。
     *
     * `.ht-today` 是 web 手写的 CSS 类，随 M3 motivation 换装**已被删除**。
     * 现在渲染它的是共享 `TodayProgressCard`（RN `View` → `<div>`，**不是 `<section>`**），
     * testID 由宿主注入：`TodayProgressBanner.tsx:45` 的 `testID="today-progress"`。
     *
     * ⚠️ 教训：**换装共享组件时，e2e 里按 web 手写类名定位的断言会静默过期**
     * —— 单测与静态门禁都发现不了，只有真浏览器 e2e 会红。
     */
    const card = page.locator('[data-testid="today-progress"]');

    for (const tab of CARD_ON) {
      await switchView(page, tab);
      await expect(card, `${tab} 应当显示今日进度卡`).toHaveCount(1);
    }
    for (const tab of CARD_OFF) {
      await switchView(page, tab);
      await expect(card, `${tab} 不该显示今日进度卡`).toHaveCount(0);
    }

    /**
     * 🔴 浮层必须**先站到一个非任务视图上**再打开，否则这条断言测的是
     * "上一个视图是什么"而不是"设置页/搜索浮层本身"。
     * 顺序依赖是这里最容易写错的地方：从任务页直接开设置，
     * 下层透出的**就是任务页**，卡当然在 —— 那既不是 bug 也不是契约。
     *（反向那半 —— 下层视图必须继续透出 —— 由 `settings-exit.spec.ts` 钉。）
     */
    for (const overlay of OVERLAYS) {
      await switchView(page, '日历');
      await switchView(page, overlay);
      await expect(
        card,
        `${overlay} 是浮层，下层是日历时不该有今日进度卡`,
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
   */
  const VIEW_ANCHOR: Record<Tab, string> = {
    任务: 'today-progress',
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